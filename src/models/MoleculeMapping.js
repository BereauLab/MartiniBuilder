import { markRaw } from 'vue';
import defaultMappings from '../assets/mappings.json';

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
    this.activeSection = 'beads';
    this.bonds = [];             // array of [beadIdx1, beadIdx2], no VS involved
    this.virtualSites = [];      // array of bead indices
    this.vsConnections = {};     // { vsBeadIdx: [neighborBeadIdx, ...] }
    this.bondBeadCandidateIdx = null;
    this.angles = [];            // [[a, b, c], ...]
    this.dihedrals = [];         // [[a, b, c, d], ...]
    this.angleMode = null;       // 'angle' | 'dihedral' | null
    this.angleCandidates = [];   // bead indices being built
  }

  setRDKit(RDKit) {
    this.rdkit = markRaw(RDKit);
    if (this.sdfData && !this.molJson) {
      console.log("RDKit loaded late, reloading SDF data")
      this.loadSdf(this.sdfData);
    }
  }

  setActiveSection(name) {
    this.activeSection = name;
    this.bondBeadCandidateIdx = null;
    if (name !== 'angles') {
      this.angleMode = null;
      this.angleCandidates = [];
    }
  }

  async loadMappingRules(file) {
    try {
      this._applyMappingRulesJson(await file.text());
    } catch (e) {
      console.error("Failed to parse mapping JSON", e);
    }
  }

  loadMappingRulesFromJson(jsonString) {
    try {
      this._applyMappingRulesJson(jsonString);
    } catch (e) {
      console.error("Failed to parse mapping JSON", e);
    }
  }

  _applyMappingRulesJson(text) {
    this.mappingRules = JSON.parse(text);
    this.beads.forEach(bead => { bead.type = ''; });
    this.beads.forEach((_, idx) => this.assignTypeIfMatches(idx));
  }

  loadSdf(data) {
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
    this.angleMode = null;
    this.angleCandidates = [];
    this._parseCoords(data);
    if (this.rdkit) {
      if (this.molecule) this.molecule.delete();
      this.molecule = markRaw(this.rdkit.get_mol(data, '{"removeHs": false}'));
      if (this.molecule) {
        this.molJson = JSON.parse(this.molecule.get_json());
      } else {
        console.error("RDKit get_mol failed. data.substring: ", data.substring(0, 100));
      }
    }
  }

  // ── Bead assignment ────────────────────────────────────────────────────────

  toggleAtom(atomIndex, elem) {
    if (this.activeBeadIndex === null) {
      const color = this.availableColors[this.colorIdx % this.availableColors.length];
      this.colorIdx++;
      this.beads.push({
        color: color,
        atom_indices: [atomIndex],
        elements: [elem],
        type: '',
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
        if (bead.atom_indices.length === 0) {
          this.deleteBead(this.activeBeadIndex);
          return;
        }
      } else {
        bead.atom_indices.push(atomIndex);
        bead.elements.push(elem);
        if (elem !== 'H') this._addAttachedHydrogens(atomIndex, this.activeBeadIndex);
      }
    }
    // Update all beads so shared flags reflect the current cross-bead assignment
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
    // Renumber bonds and remove any referencing the deleted bead
    this.bonds = this.bonds
      .filter(bond => bond.a !== idx && bond.b !== idx)
      .map(bond => ({ ...bond, a: bond.a > idx ? bond.a - 1 : bond.a, b: bond.b > idx ? bond.b - 1 : bond.b }));
    // Renumber virtual sites
    this.virtualSites = this.virtualSites
      .filter(v => v !== idx)
      .map(v => v > idx ? v - 1 : v);
    // Renumber vsConnections
    const newVsConn = {};
    Object.entries(this.vsConnections).forEach(([k, neighbors]) => {
      const vsIdx = parseInt(k);
      if (vsIdx === idx) return;
      const newKey = vsIdx > idx ? vsIdx - 1 : vsIdx;
      newVsConn[newKey] = neighbors.filter(n => n !== idx).map(n => n > idx ? n - 1 : n);
    });
    this.vsConnections = newVsConn;
    if (this.activeBeadIndex === idx) {
      this.activeBeadIndex = null;
    } else if (this.activeBeadIndex > idx) {
      this.activeBeadIndex--;
    }
    if (this.bondBeadCandidateIdx === idx) {
      this.bondBeadCandidateIdx = null;
    } else if (this.bondBeadCandidateIdx !== null && this.bondBeadCandidateIdx > idx) {
      this.bondBeadCandidateIdx--;
    }
    this.angles = this.angles
      .filter(a => !a.includes(idx))
      .map(a => a.map(i => i > idx ? i - 1 : i));
    this.dihedrals = this.dihedrals
      .filter(d => !d.includes(idx))
      .map(d => d.map(i => i > idx ? i - 1 : i));
    this.angleCandidates = this.angleCandidates
      .filter(i => i !== idx)
      .map(i => i > idx ? i - 1 : i);
    // Recompute shared flags and type assignments for all remaining beads
    this.beads.forEach((_, i) => this.updateBeadProperties(i));
  }

  // ── Bond management ────────────────────────────────────────────────────────

  hasBond(idx1, idx2) {
    const a = Math.min(idx1, idx2), b = Math.max(idx1, idx2);
    return this.bonds.some(bond => bond.a === a && bond.b === b);
  }

  addBond(idx1, idx2, constraint = false) {
    if (!this.hasBond(idx1, idx2))
      this.bonds.push({ a: Math.min(idx1, idx2), b: Math.max(idx1, idx2), constraint });
  }

  removeBond(idx1, idx2) {
    const a = Math.min(idx1, idx2), b = Math.max(idx1, idx2);
    const i = this.bonds.findIndex(bond => bond.a === a && bond.b === b);
    if (i !== -1) this.bonds.splice(i, 1);
  }

  deleteBondAt(i) {
    this.bonds.splice(i, 1);
  }

  // Called when clicking an atom while in bonds section (routes to index-based version)
  toggleBondBead(atomIndex) {
    const beadIdx = this.beads.findIndex(b => b.atom_indices.includes(atomIndex));
    if (beadIdx !== -1) this.toggleBondBeadByIndex(beadIdx);
  }

  toggleBondBeadByIndex(beadIdx) {
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

  // ── Angle / dihedral management ────────────────────────────────────────────

  setAngleMode(mode) {
    this.angleMode = this.angleMode === mode ? null : mode;
    this.angleCandidates = [];
  }

  toggleAngleBead(beadIdx) {
    if (this.angleMode === null) return;
    const pos = this.angleCandidates.indexOf(beadIdx);
    if (pos !== -1) {
      this.angleCandidates.splice(pos, 1);
      return;
    }
    this.angleCandidates.push(beadIdx);
    const needed = this.angleMode === 'angle' ? 3 : 4;
    if (this.angleCandidates.length === needed) {
      if (this.angleMode === 'angle') this.angles.push([...this.angleCandidates]);
      else this.dihedrals.push([...this.angleCandidates]);
      this.angleCandidates = [];
    }
  }

  clearAngleCandidates() {
    this.angleCandidates = [];
  }

  deleteAngleAt(i) { this.angles.splice(i, 1); }
  deleteDihedralAt(i) { this.dihedrals.splice(i, 1); }

  // ── Virtual site management ────────────────────────────────────────────────

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
    // Restore connections as constraint bonds (only to non-VS neighbours)
    const connections = this.vsConnections[beadIdx] || [];
    connections.forEach(neighborIdx => {
      if (!this.virtualSites.includes(neighborIdx))
        this.addBond(beadIdx, neighborIdx, true);
    });
    delete this.vsConnections[beadIdx];
  }

  // ── Auto-assign ────────────────────────────────────────────────────────────

  autoAssignBondsAndVS() {
    if (!this.molJson) return;
    const molObj = this.molJson.molecules[0];
    if (!molObj?.bonds) return;

    const atomToBead = new Map();
    this.beads.forEach((bead, idx) => {
      bead.atom_indices.forEach((aIdx, i) => {
        if (bead.elements[i] !== 'H') atomToBead.set(aIdx, idx);
      });
    });

    const aromaticAtoms = new Set(
      molObj.extensions?.find(e => e.name === 'rdkitRepresentation')?.aromaticAtoms || []
    );

    // Build adjacency for ALL atoms
    const adj = new Map();
    molObj.bonds.forEach(({ atoms: [a1, a2] }) => {
      if (!adj.has(a1)) adj.set(a1, []);
      if (!adj.has(a2)) adj.set(a2, []);
      adj.get(a1).push(a2);
      adj.get(a2).push(a1);
    });

    // cgBondMap: key → { a, b, constraint }
    // Direct bonds that are aromatic → constraint; 2-hop bonds → never constraint
    const cgBondMap = new Map();

    molObj.bonds.forEach(({ atoms: [a1, a2] }) => {
      const bA = atomToBead.get(a1), bB = atomToBead.get(a2);
      if (bA === undefined || bB === undefined || bA === bB) return;
      const key = `${Math.min(bA, bB)}-${Math.max(bA, bB)}`;
      const isAromatic = aromaticAtoms.has(a1) && aromaticAtoms.has(a2);
      if (!cgBondMap.has(key)) {
        cgBondMap.set(key, { a: Math.min(bA, bB), b: Math.max(bA, bB), constraint: isAromatic });
      } else if (isAromatic) {
        cgBondMap.get(key).constraint = true;
      }
    });

    adj.forEach((neighbours) => {
      for (let i = 0; i < neighbours.length - 1; i++) {
        const bA = atomToBead.get(neighbours[i]);
        if (bA === undefined) continue;
        for (let j = i + 1; j < neighbours.length; j++) {
          const bB = atomToBead.get(neighbours[j]);
          if (bB === undefined || bB === bA) continue;
          const key = `${Math.min(bA, bB)}-${Math.max(bA, bB)}`;
          if (!cgBondMap.has(key))
            cgBondMap.set(key, { a: Math.min(bA, bB), b: Math.max(bA, bB), constraint: false });
        }
      }
    });

    const tentativeBonds = [...cgBondMap.values()];

    // VS candidates: beads with ≥4 constraint bonds
    const constraintCounts = new Array(this.beads.length).fill(0);
    tentativeBonds.forEach(({ a, b, constraint }) => {
      if (constraint) { constraintCounts[a]++; constraintCounts[b]++; }
    });
    const vsCandidates = constraintCounts.map((c, i) => c >= 4 ? i : -1).filter(i => i !== -1);

    // Build adjacency among VS candidates, then pick maximum independent set
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

    // For each VS constructed by exactly 4 beads, add the shorter diagonal
    // constraint between the non-adjacent pair to prevent ring shear.
    const bondKeySet = new Set(this.bonds.map(({ a, b }) => `${a}-${b}`));
    this.virtualSites.forEach(vsIdx => {
      const cs = this.vsConnections[vsIdx] || [];
      if (cs.length !== 4) return;
      const diagonals = [];
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const key = `${Math.min(cs[i], cs[j])}-${Math.max(cs[i], cs[j])}`;
          if (!bondKeySet.has(key)) diagonals.push([cs[i], cs[j]]);
        }
      }
      if (diagonals.length === 0) return;
      const shortest = diagonals.reduce((best, [p, q]) => {
        const cogP = this.beads[p]?.cog, cogQ = this.beads[q]?.cog;
        if (!cogP || !cogQ) return best;
        const d = Math.hypot(cogP.x - cogQ.x, cogP.y - cogQ.y, cogP.z - cogQ.z);
        return d < best.d ? { d, pair: [p, q] } : best;
      }, { d: Infinity, pair: null });
      if (!shortest.pair) return;
      const [p, q] = shortest.pair;
      const key = `${Math.min(p, q)}-${Math.max(p, q)}`;
      this.bonds.push({ a: Math.min(p, q), b: Math.max(p, q), constraint: true });
      bondKeySet.add(key);
    });
  }

  autoAssignAnglesAndDihedrals() {
    this.angles = [];
    this.dihedrals = [];

    const n = this.beads.length;
    const adj = Array.from({ length: n }, () => []);
    const bondKeySet = new Set();
    const constraintKeySet = new Set();
    this.bonds.forEach(({ a, b, constraint }) => {
      adj[a].push(b);
      adj[b].push(a);
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      bondKeySet.add(key);
      if (constraint) constraintKeySet.add(key);
    });
    const hasBond = (a, b) => bondKeySet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
    const isConstraint = (a, b) => constraintKeySet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

    // 1. Angles: Homogeneous distribution
    const angleSet = new Set();
    for (let b = 0; b < n; b++) {
      const nb = adj[b];
      for (let i = 0; i < nb.length - 1; i++) {
        for (let j = i + 1; j < nb.length; j++) {
          const a = nb[i], c = nb[j];
          if (hasBond(a, c)) continue; // Triangle exclusion
          const key = `${Math.min(a, c)}-${b}-${Math.max(a, c)}`;
          if (!angleSet.has(key)) {
            angleSet.add(key);
            this.angles.push([a, b, c]);
          }
        }
      }
    }

    const dihSet = new Set();
    const addDih = (p0, p1, p2, p3) => {
      const key = `${p0}-${p1}-${p2}-${p3}`;
      if (!dihSet.has(key)) {
        dihSet.add(key);
        this.dihedrals.push([p0, p1, p2, p3]);
      }
    };

    // 2. Improper dihedrals (Case 1): Symmetric Assignment
    // Generates exactly 'k' impropers symmetrically distributed around the hub
    for (let b = 0; b < n; b++) {
      const constraintNb = adj[b].filter(nb => isConstraint(b, nb));
      const k = constraintNb.length;
      if (k < 3) continue;

      for (let i = 0; i < k; i++) {
        const p0 = constraintNb[i];
        const p1 = b; // Central hub
        const p2 = constraintNb[(i + 1) % k];
        const p3 = constraintNb[(i + 2) % k];
        addDih(p0, p1, p2, p3);
      }
    }

    // 3. Improper dihedrals (Case 2): Virtual site constructor rings
    this.virtualSites.forEach(vsIdx => {
      const cs = this.vsConnections[vsIdx] || [];
      if (cs.length < 4) return;
      const csSet = new Set(cs);
      const ringAdj = new Map(cs.map(c => [c, adj[c].filter(nb => csSet.has(nb))]));
      const visited = new Set([cs[0]]);
      const path = [cs[0]];
      let curr = cs[0];
      while (path.length < cs.length) {
        const next = (ringAdj.get(curr) || []).find(nb => !visited.has(nb));
        if (!next) break;
        visited.add(next);
        path.push(next);
        curr = next;
      }
      if (path.length >= 4) {
        const [p0, p1, p2, p3] = path;
        addDih(p0, p1, p2, p3);
      }
    });
  }

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

  // ── Atom / bead properties ─────────────────────────────────────────────────

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
    for (const [sig, types] of Object.entries(defaultMappings)) {
      result[sig] = [...types];
    }
    if (this.mappingRules) {
      for (const [sig, types] of Object.entries(this.mappingRules)) {
        if (result[sig]) {
          const merged = [...types];
          result[sig].forEach(t => { if (!merged.includes(t)) merged.push(t); });
          result[sig] = merged;
        } else {
          result[sig] = [...types];
        }
      }
    }
    return result;
  }

  assignTypeIfMatches(idx) {
    const bead = this.beads[idx];
    if (!bead.properties || bead.properties.length === 0) { bead.type = ''; return; }
    const types = this.combinedMappings[bead.signature];
    bead.type = types?.[0] ?? '';
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────

  _parseCoords(data) {
    this.coords = [];
    if (!data) return;
    const lines = data.split(/\r?\n/);
    if (lines.length < 4) return;
    const countLine = lines[3];
    const numAtoms = parseInt(countLine.substring(0, 3).trim(), 10);
    if (isNaN(numAtoms)) return;
    for (let i = 0; i < numAtoms; i++) {
      const line = lines[4 + i];
      if (!line) continue;
      const x = parseFloat(line.substring(0, 10));
      const y = parseFloat(line.substring(10, 20));
      const z = parseFloat(line.substring(20, 30));
      this.coords.push({ x, y, z });
    }
  }

  _calculateCog(indices) {
    let nx = 0, ny = 0, nz = 0;
    let count = 0;
    indices.forEach(idx => {
      if (this.coords && this.coords[idx]) {
        nx += this.coords[idx].x;
        ny += this.coords[idx].y;
        nz += this.coords[idx].z;
        count++;
      }
    });
    if (count === 0) return { x: 0, y: 0, z: 0 };
    return { x: nx / count, y: ny / count, z: nz / count };
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
