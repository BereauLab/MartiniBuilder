import { markRaw } from 'vue';

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
    this.bonds = [];          // array of [beadIdx1, beadIdx2]
    this.virtualSites = [];   // array of bead indices
    this.bondBeadCandidateIdx = null;
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
  }

  async loadMappingRules(file) {
    try {
      const text = await file.text();
      const rules = JSON.parse(text);
      this.mappingRules = Array.isArray(rules) ? rules : Object.values(rules);
      this.beads.forEach((_, idx) => this.assignTypeIfMatches(idx));
    } catch (e) {
      console.error("Failed to parse mapping JSON", e);
    }
  }

  loadSdf(data) {
    this.sdfData = data;
    this.beads = [];
    this.activeBeadIndex = null;
    this.colorIdx = 0;
    this.molJson = null;
    this.bonds = [];
    this.virtualSites = [];
    this.bondBeadCandidateIdx = null;
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
    this.updateBeadProperties(this.activeBeadIndex);
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
      .filter(b => b[0] !== idx && b[1] !== idx)
      .map(([a, b]) => [a > idx ? a - 1 : a, b > idx ? b - 1 : b]);
    // Renumber virtual sites
    this.virtualSites = this.virtualSites
      .filter(v => v !== idx)
      .map(v => v > idx ? v - 1 : v);
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
  }

  // ── Bond management ────────────────────────────────────────────────────────

  hasBond(idx1, idx2) {
    const a = Math.min(idx1, idx2), b = Math.max(idx1, idx2);
    return this.bonds.some(bond => bond[0] === a && bond[1] === b);
  }

  addBond(idx1, idx2) {
    if (!this.hasBond(idx1, idx2))
      this.bonds.push([Math.min(idx1, idx2), Math.max(idx1, idx2)]);
  }

  removeBond(idx1, idx2) {
    const a = Math.min(idx1, idx2), b = Math.max(idx1, idx2);
    const i = this.bonds.findIndex(bond => bond[0] === a && bond[1] === b);
    if (i !== -1) this.bonds.splice(i, 1);
  }

  deleteBondAt(i) {
    this.bonds.splice(i, 1);
  }

  // Called when clicking an atom while in bonds section
  toggleBondBead(atomIndex) {
    const beadIdx = this.beads.findIndex(b => b.atom_indices.includes(atomIndex));
    if (beadIdx === -1) return;

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

  // ── Virtual site management ────────────────────────────────────────────────

  addVirtualSite(beadIdx) {
    if (!this.virtualSites.includes(beadIdx)) this.virtualSites.push(beadIdx);
  }

  removeVirtualSite(beadIdx) {
    const i = this.virtualSites.indexOf(beadIdx);
    if (i !== -1) this.virtualSites.splice(i, 1);
  }

  // ── Auto-assign ────────────────────────────────────────────────────────────

  autoAssignBondsAndVS() {
    if (!this.molJson) return;
    const molObj = this.molJson.molecules[0];

    // Map heavy atom index → bead index
    const atomToBead = {};
    this.beads.forEach((bead, idx) => {
      bead.atom_indices.forEach((aIdx, i) => {
        if (bead.elements[i] !== 'H') atomToBead[aIdx] = idx;
      });
    });

    const bondSet = new Set();

    if (molObj.bonds) {
      // Build heavy-atom adjacency for 1-hop detection
      const adj = {};
      Object.keys(atomToBead).forEach(k => { adj[k] = []; });
      molObj.bonds.forEach(b => {
        const [a1, a2] = b.atoms;
        if (adj[a1] !== undefined) adj[a1].push(a2);
        if (adj[a2] !== undefined) adj[a2].push(a1);
      });

      molObj.bonds.forEach(b => {
        const [a1, a2] = b.atoms;
        const b1 = atomToBead[a1], b2 = atomToBead[a2];
        // Direct bond between different beads
        if (b1 !== undefined && b2 !== undefined && b1 !== b2) {
          bondSet.add(`${Math.min(b1, b2)}-${Math.max(b1, b2)}`);
        }
        // 1-hop: a1 → a2 → neighbour in a third bead
        if (b1 !== undefined && b2 === undefined) {
          (adj[a2] || []).forEach(a3 => {
            const b3 = atomToBead[a3];
            if (b3 !== undefined && b3 !== b1)
              bondSet.add(`${Math.min(b1, b3)}-${Math.max(b1, b3)}`);
          });
        }
        if (b2 !== undefined && b1 === undefined) {
          (adj[a1] || []).forEach(a3 => {
            const b3 = atomToBead[a3];
            if (b3 !== undefined && b3 !== b2)
              bondSet.add(`${Math.min(b2, b3)}-${Math.max(b2, b3)}`);
          });
        }
      });
    }

    this.bonds = [...bondSet].map(key => key.split('-').map(Number));

    // Count bonds per bead → virtual sites at 4+
    const counts = new Array(this.beads.length).fill(0);
    this.bonds.forEach(([a, b]) => { counts[a]++; counts[b]++; });
    this.virtualSites = counts.map((c, i) => c >= 4 ? i : -1).filter(i => i !== -1);

    // Remove bonds between two virtual sites
    this.bonds = this.bonds.filter(([a, b]) =>
      !(this.virtualSites.includes(a) && this.virtualSites.includes(b))
    );
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

    return {
      element: this.getElementSymbol(z),
      hydrogens: impHs + explicitHs,
      aromatic: aromatic,
      bonds: heavyBonds
    };
  }

  getElementSymbol(z) {
    const syms = ["*", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr"];
    return syms[z] || "X";
  }

  updateBeadProperties(idx) {
    if (!this.molJson) return;
    const bead = this.beads[idx];
    const nonHIndices = bead.atom_indices.filter((aIdx, i) => bead.elements[i] !== 'H');

    let props = nonHIndices.map(aIdx => this.getAtomDetails(aIdx)).filter(p => !!p);

    props.sort((a, b) => {
      if (a.element !== b.element) return a.element.localeCompare(b.element);
      if (a.bonds !== b.bonds) return b.bonds - a.bonds;
      if (a.aromatic !== b.aromatic) return a.aromatic === b.aromatic ? 0 : a.aromatic ? -1 : 1;
      return b.hydrogens - a.hydrogens;
    });

    bead.properties = props;
    bead.signature = JSON.stringify(props);
    bead.cog = this._calculateCog(bead.atom_indices);
    bead.radius = this._getBeadRadius(props.length);

    this.assignTypeIfMatches(idx);
  }

  assignTypeIfMatches(idx) {
    const bead = this.beads[idx];
    if (bead.type && bead.type.trim() !== '') return;
    if (!bead.properties || bead.properties.length === 0) return;

    if (this.mappingRules && !Array.isArray(this.mappingRules)) {
      for (const [t, fragment] of Object.entries(this.mappingRules)) {
        if (JSON.stringify(fragment) === bead.signature) {
          bead.type = t;
          break;
        }
      }
    }
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
