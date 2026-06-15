import { markRaw } from 'vue';
import defaultMappings from '../assets/mappings.json';
import { parseSdf, parseNdx, parseItp } from './FileParser.js';

export class MoleculeMapping {
  constructor() {
    this.sdfData = null;
    this.beads = [];
    this.activeBeadIndex = null;
    this.availableColors = this._generateBeadColors(32);
    this.colorIdx = 0;
    this.molecule = null;
    this.rdkit = null;
    this.mappingRules = {};
    this.molJson = null;
    this.coords = [];
    this.elements = [];          // element symbols parsed from the SDF atom block
    this.pendingNdx = null;      // ndx text awaiting application (e.g. before RDKit loads)
    this.pendingItp = null;      // itp text awaiting application
    this.activeSection = 'beads';
    this.bonds = [];             // { a, b, constraint, direct } objects; excludes virtual sites
    this.virtualSites = [];      // array of bead indices
    this.vsConnections = {};     // { vsBeadIdx: [neighborBeadIdx, ...] }
    this.bondBeadCandidateIdx = null;
    this.angles = [];            // [[a, b, c], ...]
    this.dihedrals = [];         // [[a, b, c, d], ...] improper
    this.properDihedrals = [];   // [[a, b, c, d], ...] proper
    this.angleMode = null;       // 'angle' | 'dihedral' | 'proper' | null
    this.angleCandidates = [];   // bead indices being built
  }

  setRDKit(RDKit) {
    // RDKit is loaded asynchronously by the parent component
    this.rdkit = markRaw(RDKit);
    if (this.sdfData && !this.molJson) {
      console.log("RDKit loaded late, reloading SDF data")
      // Pending ndx/itp data is reapplied by _loadSdfInternal.
      this._loadSdfInternal(this.sdfData);
    }
  }

  setActiveSection(name) {
    // Switching sections clears any in-progress bond or angle assignment
    this.activeSection = name;
    this.bondBeadCandidateIdx = null;
    if (name !== 'angles') {
      this.angleMode = null;
      this.angleCandidates = [];
    }
  }

  async loadMappingRules(file) {
    // Load mapping rules from a JSON file
    try {
      this._applyMappingRulesJson(await file.text());
    } catch (e) {
      console.error("Failed to parse mapping JSON", e);
    }
  }

  loadMappingRulesFromJson(jsonString) {
    // Load mapping rules from a JSON string (e.g. pasted by the user)
    try {
      this._applyMappingRulesJson(jsonString);
    } catch (e) {
      console.error("Failed to parse mapping JSON", e);
    }
  }

  _applyMappingRulesJson(text) {
    // Apply mapping rules to the already created beads
    this.mappingRules = JSON.parse(text);
    this.beads.forEach((bead, idx) => {
      if (bead.userEdited) return;
      bead.type = '';
      this.assignTypeIfMatches(idx);
    });
  }

  loadSdf(data) {
    // Plain SDF-only load: discard any pending mapping/topology files.
    this.pendingNdx = null;
    this.pendingItp = null;
    this._loadSdfInternal(data);
  }

  // Load an SDF with an optional atom-to-bead mapping (.ndx) and CG topology
  // (.itp). The ndx populates beads; the itp adds types, bonds, angles,
  // dihedrals and virtual sites.
  loadFiles(sdfData, ndxText = null, itpText = null) {
    this.pendingNdx = ndxText || null;
    this.pendingItp = itpText || null;
    this._loadSdfInternal(sdfData);
  }

  _loadSdfInternal(data) {
    this.sdfData = data;
    this.beads = [];
    this.activeBeadIndex = null;
    this.colorIdx = 0;
    this.molJson = null;
    this.bonds = [];
    this.virtualSites = [];
    this.vsConnections = {};
    this.bondBeadCandidateIdx = null;
    this.angles = [];
    this.dihedrals = [];
    this.properDihedrals = [];
    this.angleMode = null;
    this.angleCandidates = [];
    const { coords, elements } = parseSdf(data);
    this.coords = coords;
    this.elements = elements;
    if (this.rdkit) {
      if (this.molecule) this.molecule.delete();
      this.molecule = markRaw(this.rdkit.get_mol(data, '{"removeHs": false}'));
      if (this.molecule) {
        this.molJson = JSON.parse(this.molecule.get_json());
      } else {
        console.error("RDKit get_mol failed. data.substring: ", data.substring(0, 100));
      }
    }
    this._applyPendingFiles();
  }

  // Apply pending ndx/itp files after the SDF is loaded; re-runs on a late RDKit load.
  _applyPendingFiles() {
    if (this.pendingNdx) {
      this._buildBeadsFromNdx(parseNdx(this.pendingNdx));
    }
    if (this.pendingItp && this.beads.length > 0) {
      this._applyItpTopology(parseItp(this.pendingItp));
    }
  }

  // Build beads from parsed ndx groups (arrays of 0-based atom indices).
  _buildBeadsFromNdx(groups) {
    this.beads = [];
    this.colorIdx = 0;
    groups.forEach(atomIndices => {
      const color = this.availableColors[this.colorIdx % this.availableColors.length];
      this.colorIdx++;
      this.beads.push({
        color,
        atom_indices: [...atomIndices],
        elements: atomIndices.map(i => this.elements[i] || 'C'),
        type: '',
        userEdited: false,
        properties: [],
        signature: '[]',
        cog: { x: 0, y: 0, z: 0 },
        radius: 1.4
      });
    });
    // Compute properties, signatures, COGs and types (requires molJson).
    this.beads.forEach((_, i) => this.updateBeadProperties(i));
  }

  // Apply parsed itp topology onto the already-built beads.
  _applyItpTopology(topo) {
    // Flag itp-provided types as userEdited so mapping rules don't override them.
    topo.atoms.forEach(({ index, type }) => {
      const bead = this.beads[index];
      if (!bead || !type) return;
      bead.type = type;
      bead.userEdited = true;
    });

    this.bonds = topo.bonds
      .filter(({ a, b }) => this.beads[a] && this.beads[b])
      .map(({ a, b, constraint }) => ({
        a: Math.min(a, b),
        b: Math.max(a, b),
        constraint,
        direct: this._isDirectBond(a, b)
      }));

    this.angles = topo.angles.filter(idx => idx.every(i => this.beads[i]));
    this.dihedrals = topo.dihedrals.filter(idx => idx.every(i => this.beads[i]));
    this.properDihedrals = topo.properDihedrals.filter(idx => idx.every(i => this.beads[i]));

    this.virtualSites = [];
    this.vsConnections = {};
    topo.virtualSites.forEach(({ site, constructors }) => {
      if (!this.beads[site]) return;
      this.virtualSites.push(site);
      this.vsConnections[site] = constructors.filter(i => this.beads[i]);
    });
  }

  // --- Bead assignment ---

  toggleAtom(atomIndex, elem) {
    if (this.activeBeadIndex === null) {
      const color = this.availableColors[this.colorIdx % this.availableColors.length];
      this.colorIdx++;
      this.beads.push({
        color: color,
        atom_indices: [atomIndex],
        elements: [elem],
        type: '',
        userEdited: false,
        properties: [],
        signature: '[]',
        cog: { x: 0, y: 0, z: 0 },
        radius: 1.4
      });
      this.activeBeadIndex = this.beads.length - 1;
      if (elem !== 'H') this._addAttachedHydrogens(atomIndex, this.activeBeadIndex);
    } else {
      const bead = this.beads[this.activeBeadIndex];
      const idx = bead.atom_indices.indexOf(atomIndex);
      if (idx !== -1) {
        bead.atom_indices.splice(idx, 1);
        bead.elements.splice(idx, 1);
        // A bead with no heavy atoms left (only orphaned hydrogens) is removed.
        if (!bead.elements.some(e => e !== 'H')) {
          this.deleteBead(this.activeBeadIndex);
          return;
        }
      } else {
        bead.atom_indices.push(atomIndex);
        bead.elements.push(elem);
        if (elem !== 'H') this._addAttachedHydrogens(atomIndex, this.activeBeadIndex);
      }
    }
    // Refresh all beads so shared flags reflect the current assignment.
    this.beads.forEach((_, i) => this.updateBeadProperties(i));
  }

  clearActiveBead() {
    this.activeBeadIndex = null;
  }

  setActiveBead(idx) {
    this.activeBeadIndex = idx;
  }

  deleteBead(idx) {
    this.beads.splice(idx, 1);

    // Helper to shift indices down after the removed bead.
    const shift = i => (i > idx ? i - 1 : i);

    // Drop references to the removed bead and shift higher indices down.
    this.bonds = this.bonds
      .filter(bond => bond.a !== idx && bond.b !== idx)
      .map(bond => ({ ...bond, a: shift(bond.a), b: shift(bond.b) }));
    this.virtualSites = this.virtualSites.filter(v => v !== idx).map(shift);

    const newVsConn = {};
    Object.entries(this.vsConnections).forEach(([k, neighbors]) => {
      const vsIdx = parseInt(k);
      if (vsIdx === idx) return;
      newVsConn[shift(vsIdx)] = neighbors.filter(n => n !== idx).map(shift);
    });
    this.vsConnections = newVsConn;

    if (this.activeBeadIndex === idx) this.activeBeadIndex = null;
    else if (this.activeBeadIndex !== null) this.activeBeadIndex = shift(this.activeBeadIndex);

    if (this.bondBeadCandidateIdx === idx) this.bondBeadCandidateIdx = null;
    else if (this.bondBeadCandidateIdx !== null) this.bondBeadCandidateIdx = shift(this.bondBeadCandidateIdx);

    // Angles and dihedrals containing the removed bead are dropped; others are shifted.
    this.angles = this.angles.filter(a => !a.includes(idx)).map(a => a.map(shift));
    this.dihedrals = this.dihedrals.filter(d => !d.includes(idx)).map(d => d.map(shift));
    this.properDihedrals = this.properDihedrals.filter(d => !d.includes(idx)).map(d => d.map(shift));
    this.angleCandidates = this.angleCandidates.filter(i => i !== idx).map(shift);

    // Recompute shared flags and type assignments for the remaining beads.
    this.beads.forEach((_, i) => this.updateBeadProperties(i));
  }

  // --- Bond management ---

  hasBond(idx1, idx2) {
    const a = Math.min(idx1, idx2);
    const b = Math.max(idx1, idx2);
    return this.bonds.some(bond => bond.a === a && bond.b === b);
  }

  addBond(idx1, idx2, constraint = false) {
    if (!this.hasBond(idx1, idx2))
      this.bonds.push({ a: Math.min(idx1, idx2), b: Math.max(idx1, idx2), constraint, direct: this._isDirectBond(idx1, idx2) });
  }

  _isDirectBond(idx1, idx2) {
    if (!this.molJson) return true;
    const bonds = this.molJson.molecules[0]?.bonds;
    if (!bonds) return true;
    const a1 = new Set(this.beads[idx1]?.atom_indices || []);
    const a2 = new Set(this.beads[idx2]?.atom_indices || []);
    return bonds.some(({ atoms: [a, b] }) =>
      (a1.has(a) && a2.has(b)) || (a1.has(b) && a2.has(a))
    );
  }

  removeBond(idx1, idx2) {
    const a = Math.min(idx1, idx2), b = Math.max(idx1, idx2);
    const i = this.bonds.findIndex(bond => bond.a === a && bond.b === b);
    if (i !== -1) this.bonds.splice(i, 1);
  }

  deleteBondAt(i) {
    this.bonds.splice(i, 1);
  }

  toggleBondBead(atomIndex) {
    // Maps a clicked atom to its bead, then toggles a bond candidate.
    const beadIdx = this.beads.findIndex(b => b.atom_indices.includes(atomIndex));
    if (beadIdx !== -1) this.toggleBondBeadByIndex(beadIdx);
  }

  toggleBondBeadByIndex(beadIdx) {
    // Saves/deletes a bond candidate or adds a bond if a candidate already exists
    if (this.bondBeadCandidateIdx === null) {
      this.bondBeadCandidateIdx = beadIdx;
    } else if (this.bondBeadCandidateIdx === beadIdx) {
      this.bondBeadCandidateIdx = null;
    } else {
      if (this.hasBond(this.bondBeadCandidateIdx, beadIdx)) {
        this.removeBond(this.bondBeadCandidateIdx, beadIdx);
      } else {
        this.addBond(this.bondBeadCandidateIdx, beadIdx);
      }
      this.bondBeadCandidateIdx = null;
    }
  }

  clearBondCandidate() {
    this.bondBeadCandidateIdx = null;
  }

  // --- Angle / dihedral management ---

  setAngleMode(mode) {
    this.angleMode = this.angleMode === mode ? null : mode;
    this.angleCandidates = [];
  }

  toggleAngleBeadByAtom(atomIndex) {
    // Maps a clicked atom to its bead, then toggles an angle/dihedral candidate.
    const beadIdx = this.beads.findIndex(b => b.atom_indices.includes(atomIndex));
    if (beadIdx !== -1) this.toggleAngleBead(beadIdx);
  }

  toggleAngleBead(beadIdx) {
    // Adds/removes a bead from the current angle/dihedral candidate list, and saves
    // the angle/dihedral if the required number of candidates is reached.
    if (this.angleMode === null) return;
    const pos = this.angleCandidates.indexOf(beadIdx);
    if (pos !== -1) {
      this.angleCandidates.splice(pos, 1);
      return;
    }
    this.angleCandidates.push(beadIdx);
    const needed = this.angleMode === 'angle' ? 3 : 4;
    if (this.angleCandidates.length < needed) return;
    const target = this.angleMode === 'angle' ? this.angles
      : this.angleMode === 'dihedral' ? this.dihedrals
        : this.properDihedrals;
    target.push([...this.angleCandidates]);
    this.angleCandidates = [];
  }

  clearAngleCandidates() {
    this.angleCandidates = [];
  }

  deleteAngleAt(i) { this.angles.splice(i, 1); }
  deleteDihedralAt(i) { this.dihedrals.splice(i, 1); }
  deleteProperDihedralAt(i) { this.properDihedrals.splice(i, 1); }

  // --- Virtual site management ---

  addVirtualSite(beadIdx) {
    if (!this.virtualSites.includes(beadIdx)) this.virtualSites.push(beadIdx);
  }

  promoteToVirtualSite(beadIdx) {
    if (beadIdx === null || this.virtualSites.includes(beadIdx)) return;
    const connections = this.bonds
      .filter(({ a, b }) => a === beadIdx || b === beadIdx)
      .map(({ a, b }) => (a === beadIdx ? b : a))
      .filter(nIdx => !this.virtualSites.includes(nIdx));
    this.bonds = this.bonds.filter(({ a, b }) => a !== beadIdx && b !== beadIdx);
    this.virtualSites.push(beadIdx);
    this.vsConnections[beadIdx] = connections;
    this.bondBeadCandidateIdx = null;
  }

  removeVirtualSite(beadIdx) {
    const i = this.virtualSites.indexOf(beadIdx);
    if (i === -1) return;
    this.virtualSites.splice(i, 1);
    // Restore connections to non-VS neighbours as constraint bonds.
    const connections = this.vsConnections[beadIdx] || [];
    connections.forEach(neighborIdx => {
      if (!this.virtualSites.includes(neighborIdx))
        this.addBond(beadIdx, neighborIdx, true);
    });
    delete this.vsConnections[beadIdx];
  }

  // --- Auto-assign ---

  autoAssignBondsAndVS() {
    if (!this.molJson) return;
    const molObj = this.molJson.molecules[0];
    if (!molObj?.bonds) return;

    // Map each heavy atom to the bead(s) containing it (an atom may be shared).
    const atomToBeads = new Map();
    this.beads.forEach((bead, idx) => {
      bead.atom_indices.forEach((aIdx, i) => {
        if (bead.elements[i] === 'H') return;
        if (!atomToBeads.has(aIdx)) atomToBeads.set(aIdx, []);
        atomToBeads.get(aIdx).push(idx);
      });
    });

    // Indices (into molObj.bonds) of bonds RDKit flags as aromatic. Inter-ring
    // single bonds (e.g. the biphenyl junction) are not aromatic.
    const aromaticBondIdx = new Set(
      molObj.extensions?.find(e => e.name === 'rdkitRepresentation')?.aromaticBonds || []
    );

    // Build adjacency over all atoms.
    const adj = new Map();
    molObj.bonds.forEach(({ atoms: [a1, a2] }) => {
      if (!adj.has(a1)) adj.set(a1, []);
      if (!adj.has(a2)) adj.set(a2, []);
      adj.get(a1).push(a2);
      adj.get(a2).push(a1);
    });

    // --- Bond assignment ---

    // CG bonds keyed by bead pair; constraint/direct flags merge across contributions.
    const cgBondMap = new Map();

    const addCgBond = (bA, bB, { constraint, direct }) => {
      if (bA === bB) return;
      const a = Math.min(bA, bB), b = Math.max(bA, bB);
      const existing = cgBondMap.get(`${a}-${b}`);
      if (existing) {
        if (direct) existing.direct = true;
        if (constraint) existing.constraint = true;
      } else {
        cgBondMap.set(`${a}-${b}`, { a, b, constraint, direct });
      }
    };

    // Direct bonds: an atomic bond crossing two beads. Aromatic bonds become constraints.
    molObj.bonds.forEach(({ atoms: [a1, a2] }, bondIdx) => {
      const beadsA = atomToBeads.get(a1) || [];
      const beadsB = atomToBeads.get(a2) || [];
      const isAromatic = aromaticBondIdx.has(bondIdx);
      beadsA.forEach(bA => beadsB.forEach(bB => addCgBond(bA, bB, { constraint: isAromatic, direct: true })));
    });

    // 2-hop bonds: two beads bridged by a shared atomic neighbour (a-b-c). Shared endpoints skipped.
    adj.forEach((neighbours) => {
      for (let i = 0; i < neighbours.length - 1; i++) {
        const beadsI = atomToBeads.get(neighbours[i]) || [];
        if (beadsI.length !== 1) continue; // endpoint missing or shared
        for (let j = i + 1; j < neighbours.length; j++) {
          const beadsJ = atomToBeads.get(neighbours[j]) || [];
          if (beadsJ.length !== 1) continue; // endpoint missing or shared
          beadsI.forEach(bA => beadsJ.forEach(bB => addCgBond(bA, bB, { constraint: false, direct: false })));
        }
      }
    });

    // Beads sharing a heavy atom are connected by a constraint bond.
    atomToBeads.forEach(beadList => {
      for (let i = 0; i < beadList.length - 1; i++)
        for (let j = i + 1; j < beadList.length; j++)
          addCgBond(beadList[i], beadList[j], { constraint: true, direct: true });
    });

    // --- Virtual site selection ---

    const tentativeBonds = [...cgBondMap.values()];

    // VS candidates: beads with 4 or more constraint bonds.
    const constraintCounts = new Array(this.beads.length).fill(0);
    tentativeBonds.forEach(({ a, b, constraint }) => {
      if (constraint) { constraintCounts[a]++; constraintCounts[b]++; }
    });
    const vsCandidates = constraintCounts.map((c, i) => c >= 4 ? i : -1).filter(i => i !== -1);

    // Adjacency among VS candidates, then the maximum independent set.
    const candidateSet = new Set(vsCandidates);
    const vsAdj = new Map();
    vsCandidates.forEach(v => vsAdj.set(v, []));
    tentativeBonds.forEach(({ a, b }) => {
      if (candidateSet.has(a) && candidateSet.has(b)) {
        vsAdj.get(a).push(b);
        vsAdj.get(b).push(a);
      }
    });
    this.virtualSites = this._maxIndependentSet(vsCandidates, vsAdj);

    this.vsConnections = {};
    this.virtualSites.forEach(vsIdx => {
      this.vsConnections[vsIdx] = tentativeBonds
        .filter(({ a, b }) => a === vsIdx || b === vsIdx)
        .map(({ a, b }) => (a === vsIdx ? b : a))
        .filter(nIdx => !this.virtualSites.includes(nIdx));
    });

    this.bonds = tentativeBonds.filter(({ a, b }) =>
      !this.virtualSites.includes(a) && !this.virtualSites.includes(b)
    );

    // VS with exactly 4 constructors: make the four bounding bonds constraints
    // and add both diagonals (unbonded opposite pairs) as normal bonds.
    this.virtualSites.forEach(vsIdx => {
      const cs = this.vsConnections[vsIdx] || [];
      if (cs.length !== 4) return;
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const a = Math.min(cs[i], cs[j]), b = Math.max(cs[i], cs[j]);
          const existing = this.bonds.find(bond => bond.a === a && bond.b === b);
          if (existing) {
            existing.constraint = true; // bounding bond → constraint
          } else {
            this.bonds.push({ a, b, constraint: false, direct: this._isDirectBond(a, b) }); // diagonal → normal bond
          }
        }
      }
    });
  }

  autoAssignAnglesAndDihedrals() {
    this.angles = [];
    this.dihedrals = [];
    this.properDihedrals = [];

    const n = this.beads.length;

    // directAdj: direct bonds only (two-hop excluded). Plus bond/constraint lookups.
    const directAdj = Array.from({ length: n }, () => []);
    const bondKeySet = new Set();
    const constraintKeySet = new Set();
    this.bonds.forEach(({ a, b, constraint, direct }) => {
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (direct !== false) {
        directAdj[a].push(b);
        directAdj[b].push(a);
      }
      bondKeySet.add(key);
      if (constraint) constraintKeySet.add(key);
    });
    const hasBond = (a, b) => bondKeySet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
    const isConstraint = (a, b) => constraintKeySet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

    // Angles: at each central bead, split its direct neighbours into bonded
    // connected components. A fully-bonded (clique) component is one rigid unit;
    // any other component contributes its members individually. Per pair of units,
    // emit one angle between two non-bonded singletons, otherwise up to two tying
    // two members of the larger unit to one member of the smaller. An angle pins
    // its two outer beads, so only one angle is kept per outer-bead pair (e.g. a
    // shared-bond hinge is restrained once rather than from both ends).
    const seenAnglePairs = new Set();
    const addAngle = (x, mid, y) => {
      const key = `${Math.min(x, y)}-${Math.max(x, y)}`;
      if (seenAnglePairs.has(key)) return;
      seenAnglePairs.add(key);
      this.angles.push([x, mid, y]);
    };
    for (let b = 0; b < n; b++) {
      const nb = [...new Set(directAdj[b])];
      if (nb.length < 2) continue;
      const parent = new Map(nb.map(x => [x, x]));
      const find = x => {
        while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
        return x;
      };
      for (let i = 0; i < nb.length - 1; i++)
        for (let j = i + 1; j < nb.length; j++)
          if (hasBond(nb[i], nb[j])) parent.set(find(nb[i]), find(nb[j]));
      const comps = new Map();
      nb.forEach(x => {
        const r = find(x);
        if (!comps.has(r)) comps.set(r, []);
        comps.get(r).push(x);
      });
      const units = [];
      for (const members of comps.values()) {
        members.sort((p, q) => p - q);
        let clique = members.length >= 2;
        for (let i = 0; clique && i < members.length - 1; i++)
          for (let j = i + 1; j < members.length; j++)
            if (!hasBond(members[i], members[j])) { clique = false; break; }
        if (clique) units.push(members);
        else members.forEach(m => units.push([m]));
      }
      units.sort((p, q) => p[0] - q[0]);
      for (let i = 0; i < units.length - 1; i++) {
        for (let j = i + 1; j < units.length; j++) {
          const U = units[i], V = units[j];
          if (U.length === 1 && V.length === 1) {
            if (!hasBond(U[0], V[0])) addAngle(U[0], b, V[0]);
          } else {
            const [big, small] = U.length >= V.length ? [U, V] : [V, U];
            const t = small[0];
            addAngle(big[0], b, t);
            if (big.length >= 2) addAngle(big[1], b, t);
          }
        }
      }
    }

    // Proper dihedrals: one torsion i-j-k-l per rotatable (non-constraint, direct)
    // bond j-k with at least one constrained neighbour; i and l prefer such neighbours.
    const properDihSet = new Set();
    this.bonds.forEach(({ a: j, b: k, constraint, direct }) => {
      if (constraint || direct === false) return;
      const jNb = directAdj[j].filter(x => x !== k);
      const kNb = directAdj[k].filter(x => x !== j);
      if (!jNb.length || !kNb.length) return;
      const jHasConstraint = jNb.some(nb => isConstraint(j, nb));
      const kHasConstraint = kNb.some(nb => isConstraint(k, nb));
      if (!jHasConstraint && !kHasConstraint) return;
      const iCand = [...jNb.filter(nb => isConstraint(j, nb)), ...jNb.filter(nb => !isConstraint(j, nb))];
      const lCand = [...kNb.filter(nb => isConstraint(k, nb)), ...kNb.filter(nb => !isConstraint(k, nb))];
      const i = iCand[0], l = lCand[0];
      if (i === l) return;
      const fwd = `${i}-${j}-${k}-${l}`, rev = `${l}-${k}-${j}-${i}`;
      if (!properDihSet.has(fwd) && !properDihSet.has(rev)) {
        properDihSet.add(fwd);
        this.properDihedrals.push([i, j, k, l]);
      }
    });
  }

  // Branch-and-bound search for the largest set of candidates with no edge between any two.
  _maxIndependentSet(candidates, adjMap) {
    let best = [];
    const n = candidates.length;

    function backtrack(i, current, excluded) {
      if (current.length + (n - i) <= best.length) return;
      if (i === n) { best = [...current]; return; }
      const v = candidates[i];
      if (!excluded.has(v)) {
        const newExcluded = new Set(excluded);
        (adjMap.get(v) || []).forEach(nb => newExcluded.add(nb));
        current.push(v);
        backtrack(i + 1, current, newExcluded);
        current.pop();
      }
      backtrack(i + 1, current, excluded);
    }

    backtrack(0, [], new Set());
    return best;
  }

  // --- Atom / bead properties ---

  _getBondedHydrogenIndices(heavyAtomIndex) {
    if (!this.molJson) return [];
    const molObj = this.molJson.molecules[0];
    const atomDef = this.molJson.defaults?.atom || { z: 6 };
    const hIndices = [];
    if (molObj.bonds) {
      molObj.bonds.forEach(b => {
        if (!b.atoms.includes(heavyAtomIndex)) return;
        const otherIdx = b.atoms[0] === heavyAtomIndex ? b.atoms[1] : b.atoms[0];
        const otherAtom = molObj.atoms[otherIdx] || {};
        const otherZ = otherAtom.z !== undefined ? otherAtom.z : atomDef.z;
        if (otherZ === 1) hIndices.push(otherIdx);
      });
    }
    return hIndices;
  }

  _addAttachedHydrogens(heavyAtomIndex, beadIdx) {
    const bead = this.beads[beadIdx];
    this._getBondedHydrogenIndices(heavyAtomIndex).forEach(hIdx => {
      if (!bead.atom_indices.includes(hIdx)) {
        bead.atom_indices.push(hIdx);
        bead.elements.push('H');
      }
    });
  }

  getAtomDetails(aIdx) {
    if (!this.molJson) {
      console.warn("molJson is null in getAtomDetails");
      return null;
    }

    const molObj = this.molJson.molecules[0];
    const atomDef = this.molJson.defaults?.atom || { z: 6, impHs: 0 };
    const atom = molObj.atoms[aIdx] || {};
    const z = atom.z !== undefined ? atom.z : atomDef.z;

    let impHs = atom.impHs !== undefined ? atom.impHs : (atomDef.impHs || 0);
    let explicitHs = 0;
    let heavyBonds = 0;

    if (molObj.bonds) {
      molObj.bonds.forEach(b => {
        if (b.atoms.includes(aIdx)) {
          const otherIdx = b.atoms[0] === aIdx ? b.atoms[1] : b.atoms[0];
          const otherAtom = molObj.atoms[otherIdx] || {};
          const otherZ = otherAtom.z !== undefined ? otherAtom.z : atomDef.z;
          if (otherZ === 1) explicitHs++;
          else heavyBonds++;
        }
      });
    }

    const aromatic = molObj.extensions?.find(e => e.name === 'rdkitRepresentation')?.aromaticAtoms?.includes(aIdx) || false;
    const charge = atom.chg !== undefined ? atom.chg : (atomDef.chg ?? 0);

    return {
      element: this.getElementSymbol(z),
      hydrogens: impHs + explicitHs,
      aromatic: aromatic,
      bonds: heavyBonds,
      charge: charge
    };
  }

  getElementSymbol(z) {
    const syms = ["*", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr"];
    return syms[z] || "X";
  }

  updateBeadProperties(idx) {
    if (!this.molJson) return;
    const bead = this.beads[idx];
    const nonHIndices = bead.atom_indices.filter((_, i) => bead.elements[i] !== 'H');

    let props = nonHIndices.map(aIdx => {
      const details = this.getAtomDetails(aIdx);
      if (!details) return null;
      const shared = this.beads.filter(b => b.atom_indices.includes(aIdx)).length > 1;
      return { ...details, shared };
    }).filter(p => !!p);

    props.sort((a, b) => {
      if (a.element !== b.element) return a.element.localeCompare(b.element);
      if (a.bonds !== b.bonds) return b.bonds - a.bonds;
      if (a.aromatic !== b.aromatic) return a.aromatic === b.aromatic ? 0 : a.aromatic ? -1 : 1;
      if (a.hydrogens !== b.hydrogens) return b.hydrogens - a.hydrogens;
      return b.charge - a.charge;
    });

    bead.properties = props;
    bead.signature = props.map(p =>
      `${p.element}${p.bonds}b${p.hydrogens}H${p.aromatic ? 'a' : 'n'}${p.shared ? 's' : 'u'}c${p.charge}`
    ).join(',');
    bead.cog = this._calculateCog(bead.atom_indices);
    bead.radius = this._getBeadRadius(props.length);

    this.assignTypeIfMatches(idx);
  }

  get combinedMappings() {
    const result = {};
    const add = (sig, types) => {
      if (!result[sig]) result[sig] = [];
      types.forEach(t => { if (!result[sig].includes(t)) result[sig].push(t); });
    };
    // User rules first so they take precedence over defaults.
    Object.entries(this.mappingRules || {}).forEach(([sig, types]) => add(sig, types));
    Object.entries(defaultMappings).forEach(([sig, types]) => add(sig, types));
    return result;
  }

  assignTypeIfMatches(idx) {
    const bead = this.beads[idx];
    if (bead.userEdited) return;
    if (!bead.properties || bead.properties.length === 0) { bead.type = ''; return; }
    const types = this.combinedMappings[bead.signature];
    bead.type = types?.[0] ?? '';
  }

  // --- Geometry helpers ---

  // The two bond angles (degrees) defining the dihedral's planes: A-B-C and
  // B-C-D. Returns null if any COG is missing.
  dihedralPlaneAngles([a, b, c, d]) {
    const cogA = this.beads[a]?.cog, cogB = this.beads[b]?.cog;
    const cogC = this.beads[c]?.cog, cogD = this.beads[d]?.cog;
    if (!cogA || !cogB || !cogC || !cogD) return null;
    return { abc: this._angleDeg(cogA, cogB, cogC), bcd: this._angleDeg(cogB, cogC, cogD) };
  }

  _angleDeg(a, b, c) {
    const ax = a.x - b.x, ay = a.y - b.y, az = a.z - b.z;
    const cx = c.x - b.x, cy = c.y - b.y, cz = c.z - b.z;
    const lenA = Math.hypot(ax, ay, az), lenC = Math.hypot(cx, cy, cz);
    if (!lenA || !lenC) return 0;
    const dot = (ax * cx + ay * cy + az * cz) / (lenA * lenC);
    return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
  }

  _calculateCog(indices) {
    // Atoms shared across multiple beads contribute weight 1/n to each bead's COG.
    const atomBeadCount = new Map();
    this.beads.forEach(bead => {
      bead.atom_indices.forEach(aIdx => {
        atomBeadCount.set(aIdx, (atomBeadCount.get(aIdx) || 0) + 1);
      });
    });

    let wx = 0, wy = 0, wz = 0, wTotal = 0;
    indices.forEach(idx => {
      if (this.coords && this.coords[idx]) {
        const w = 1 / (atomBeadCount.get(idx) || 1);
        wx += this.coords[idx].x * w;
        wy += this.coords[idx].y * w;
        wz += this.coords[idx].z * w;
        wTotal += w;
      }
    });
    if (wTotal === 0) return { x: 0, y: 0, z: 0 };
    return { x: wx / wTotal, y: wy / wTotal, z: wz / wTotal };
  }

  _generateBeadColors(count) {
    const L = [48, 58, 38]
    const S = [62, 72, 62]
    const colors = []
    for (let i = 0; i < count; i++) {
      const h = (i * 137.508 + 170) % 360
      colors.push(this._hslToHex(h, S[i % 3], L[i % 3]))
    }
    return colors
  }

  _hslToHex(h, s, l) {
    s /= 100
    l /= 100
    const a = s * Math.min(l, 1 - l)
    const f = n => {
      const k = (n + h / 30) % 12
      const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
      return Math.round(255 * c).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }

  _getBeadRadius(numHeavyAtoms) {
    if (numHeavyAtoms <= 2) return 1.4;
    if (numHeavyAtoms === 3) return 1.7;
    return 2.0;
  }
}
