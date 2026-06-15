// Parsers for the input files the tool understands: the SDF molecule, the
// atom-to-bead mapping (mapping.ndx) and the CG topology (mapping.itp). The NDX
// and ITP formats are the inverse of what ExportFormatter.js writes.

// ── SDF ─────────────────────────────────────────────────────────────────────

// Parse atom coordinates and element symbols from the SDF V2000 atom block.
export function parseSdf(data) {
  const coords = [];
  const elements = [];
  if (!data) return { coords, elements };
  const lines = data.split(/\r?\n/);
  if (lines.length < 4) return { coords, elements };
  const countLine = lines[3];
  const numAtoms = parseInt(countLine.substring(0, 3).trim(), 10);
  if (isNaN(numAtoms)) return { coords, elements };
  for (let i = 0; i < numAtoms; i++) {
    const line = lines[4 + i];
    if (!line) continue;
    const x = parseFloat(line.substring(0, 10));
    const y = parseFloat(line.substring(10, 20));
    const z = parseFloat(line.substring(20, 30));
    coords.push({ x, y, z });
    elements.push(line.substring(31, 34).trim());
  }
  return { coords, elements };
}

// ── NDX ─────────────────────────────────────────────────────────────────────

// Parse a GROMACS .ndx file into one group of 0-based atom indices per bead.
// Each `[ ... ]` header starts a new group; subsequent lines list 1-based atom
// indices (whitespace separated, possibly across several lines).
export function parseNdx(text) {
  const groups = [];
  let current = null;
  text.split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) return;
    if (line.startsWith('[')) {
      current = [];
      groups.push(current);
      return;
    }
    if (!current) return;
    line.split(/\s+/).forEach(tok => {
      const n = parseInt(tok, 10);
      if (!isNaN(n)) current.push(n - 1);
    });
  });
  return groups;
}

// ── ITP ─────────────────────────────────────────────────────────────────────

// Parse a Martini .itp topology. All indices are converted to 0-based. Bonds
// from [bonds] are regular, those from [constraints] are flagged. Dihedrals are
// split into improper (funct 2) and proper (funct 1) by their function number.
export function parseItp(text) {
  const result = {
    atoms: [],            // { index, type }
    bonds: [],            // { a, b, constraint }
    angles: [],           // [a, b, c]
    dihedrals: [],        // [a, b, c, d] improper
    properDihedrals: [],  // [a, b, c, d] proper
    virtualSites: [],     // { site, constructors }
  };
  let section = null;
  text.split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) return; // comment / preprocessor

    const secMatch = line.match(/^\[\s*(.+?)\s*\]$/);
    if (secMatch) {
      section = secMatch[1].toLowerCase();
      return;
    }

    const tokens = line.split(/\s+/);
    switch (section) {
      case 'atoms': {
        const nr = parseInt(tokens[0], 10);
        if (!isNaN(nr)) result.atoms.push({ index: nr - 1, type: tokens[1] || '' });
        break;
      }
      case 'bonds': {
        const a = parseInt(tokens[0], 10) - 1, b = parseInt(tokens[1], 10) - 1;
        if (a >= 0 && b >= 0) result.bonds.push({ a, b, constraint: false });
        break;
      }
      case 'constraints': {
        const a = parseInt(tokens[0], 10) - 1, b = parseInt(tokens[1], 10) - 1;
        if (a >= 0 && b >= 0) result.bonds.push({ a, b, constraint: true });
        break;
      }
      case 'angles': {
        const idx = tokens.slice(0, 3).map(t => parseInt(t, 10) - 1);
        if (!idx.some(isNaN)) result.angles.push(idx);
        break;
      }
      case 'dihedrals': {
        const idx = tokens.slice(0, 4).map(t => parseInt(t, 10) - 1);
        if (idx.some(isNaN)) break;
        const funct = parseInt(tokens[4], 10);
        if (funct === 1) result.properDihedrals.push(idx);
        else result.dihedrals.push(idx); // funct 2 (or unspecified) → improper
        break;
      }
      case 'virtual_sitesn': {
        const site = parseInt(tokens[0], 10) - 1;
        // tokens[1] is the funct; the remainder are constructing atom indices.
        const constructors = tokens.slice(2)
          .map(t => parseInt(t, 10) - 1)
          .filter(n => !isNaN(n) && n >= 0);
        if (site >= 0) result.virtualSites.push({ site, constructors });
        break;
      }
    }
  });
  return result;
}
