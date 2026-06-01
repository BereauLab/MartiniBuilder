function getMoleculeName(mapping) {
  if (!mapping.sdfData) return 'LIG';
  return mapping.sdfData.split(/\r?\n/)[0].trim() || 'LIG';
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function angleDeg(cogA, cogB, cogC) {
  const ax = cogA.x - cogB.x, ay = cogA.y - cogB.y, az = cogA.z - cogB.z;
  const cx = cogC.x - cogB.x, cy = cogC.y - cogB.y, cz = cogC.z - cogB.z;
  const lenA = Math.sqrt(ax * ax + ay * ay + az * az);
  const lenC = Math.sqrt(cx * cx + cy * cy + cz * cz);
  if (!lenA || !lenC) return 0;
  const d = (ax * cx + ay * cy + az * cz) / (lenA * lenC);
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
}

// ── NDX ───────────────────────────────────────────────────────────────────────

export function generateNdx(mapping) {
  const lines = [];
  mapping.beads.forEach((bead, idx) => {
    lines.push(`[ B${idx + 1} ]`);
    lines.push(bead.atom_indices.map(i => i + 1).join(' '));
  });
  return lines.join('\n') + '\n';
}

// ── GRO ───────────────────────────────────────────────────────────────────────

export function generateGro(mapping) {
  const molName = getMoleculeName(mapping);
  const lines = [molName, String(mapping.beads.length)];
  mapping.beads.forEach((bead, idx) => {
    const atomName = (bead.type || `B${idx + 1}`).substring(0, 5);
    const { cog } = bead;
    const line =
      String(1).padStart(5) +
      'LIG'.padEnd(5) +
      atomName.padStart(5) +
      String(idx + 1).padStart(5) +
      (cog.x / 10).toFixed(3).padStart(8) +
      (cog.y / 10).toFixed(3).padStart(8) +
      (cog.z / 10).toFixed(3).padStart(8);
    lines.push(line);
  });
  lines.push('10 10 10');
  return lines.join('\n') + '\n';
}

// ── ITP helpers ───────────────────────────────────────────────────────────────

function computeMasses(mapping) {
  const masses = mapping.beads.map(bead => {
    const t = bead.type || '';
    if (t.startsWith('T')) return 36;
    if (t.startsWith('S')) return 54;
    return 72;
  });
  mapping.virtualSites.forEach(vsIdx => {
    const constructors = mapping.vsConnections[vsIdx] || [];
    if (!constructors.length) return;
    const share = masses[vsIdx] / constructors.length;
    constructors.forEach(cIdx => { masses[cIdx] += share; });
    masses[vsIdx] = 0;
  });
  return masses;
}

function computeCharges(mapping) {
  if (!mapping.molJson) return mapping.beads.map(() => 0);
  const molObj = mapping.molJson.molecules[0];
  const defaultChg = mapping.molJson.defaults?.atom?.chg ?? 0;
  return mapping.beads.map(bead =>
    bead.atom_indices.reduce((sum, aIdx) => {
      const atom = molObj.atoms?.[aIdx] || {};
      return sum + (atom.chg !== undefined ? atom.chg : defaultChg);
    }, 0)
  );
}

// ── ITP ───────────────────────────────────────────────────────────────────────

export function generateItp(mapping) {
  const n = mapping.beads.length;
  const masses = computeMasses(mapping);
  const charges = computeCharges(mapping);
  const lines = [];

  // [moleculetype]
  lines.push('[moleculetype]');
  lines.push('; molname    nrexcl');
  lines.push(`  ligand           1`);
  lines.push('');

  // [atoms]
  lines.push('[atoms]');
  lines.push('; nr type resnr residue atom cgnr charge mass');
  mapping.beads.forEach((bead, idx) => {
    const nr = String(idx + 1).padStart(4);
    const type = (bead.type || '???').padEnd(6);
    const resnr = '1'.padStart(4);
    const atom = `B${idx + 1}`.padEnd(5);
    const cgnr = String(idx + 1).padStart(4);
    const charge = charges[idx].toFixed(3).padStart(8);
    const mass = masses[idx].toFixed(3).padStart(8);
    lines.push(`${nr}  ${type}  ${resnr}     LIG  ${atom}${cgnr}${charge}${mass}`);
  });
  lines.push('');

  // [bonds]
  const regularBonds = mapping.bonds.filter(b => !b.constraint);
  if (regularBonds.length > 0) {
    lines.push('[bonds]');
    lines.push('; i  j  funct  length  force_k');
    regularBonds.forEach(({ a, b }) => {
      const cogA = mapping.beads[a]?.cog, cogB = mapping.beads[b]?.cog;
      if (!cogA || !cogB) return;
      const len = (dist(cogA, cogB) / 10).toFixed(3);
      lines.push(`  ${String(a + 1).padStart(2)}  ${String(b + 1).padStart(2)}   1    ${len}   15000`);
    });
    lines.push('');
  }

  // [constraints]
  const constraintBonds = mapping.bonds.filter(b => b.constraint);
  if (constraintBonds.length > 0) {
    lines.push('#ifndef FLEXIBLE');
    lines.push('[constraints]');
    lines.push('#endif');
    lines.push('; i  j  funct  length');
    constraintBonds.forEach(({ a, b }) => {
      const cogA = mapping.beads[a]?.cog, cogB = mapping.beads[b]?.cog;
      if (!cogA || !cogB) return;
      const len = (dist(cogA, cogB) / 10).toFixed(3);
      lines.push(`  ${String(a + 1).padStart(2)}  ${String(b + 1).padStart(2)}   1    ${len}  100000`);
    });
    lines.push('');
  }

  // [angles]
  if (mapping.angles.length > 0) {
    lines.push('[angles]');
    lines.push('; i  j  k  funct  angle  force_k');
    mapping.angles.forEach(([a, b, c]) => {
      const cogA = mapping.beads[a]?.cog;
      const cogB = mapping.beads[b]?.cog;
      const cogC = mapping.beads[c]?.cog;
      if (!cogA || !cogB || !cogC) return;
      const ang = angleDeg(cogA, cogB, cogC).toFixed(1);
      lines.push(`  ${String(a + 1).padStart(2)}  ${String(b + 1).padStart(2)}  ${String(c + 1).padStart(2)}    2   ${ang.padStart(6)}    250`);
    });
    lines.push('');
  }

  // [dihedrals]
  if (mapping.dihedrals.length > 0) {
    lines.push('[dihedrals]');
    lines.push('; improper');
    lines.push('; i  j  k  l  funct  ref.angle  force_k');
    mapping.dihedrals.forEach(([a, b, c, d]) => {
      lines.push(
        `  ${String(a + 1).padStart(2)}  ${String(b + 1).padStart(2)}  ${String(c + 1).padStart(2)}  ${String(d + 1).padStart(2)}    2        0       100`
      );
    });
    lines.push('');
  }

  // [virtual_sitesn]
  if (mapping.virtualSites.length > 0) {
    lines.push('[virtual_sitesn]');
    lines.push('; site funct  constructing atom indices');
    mapping.virtualSites.forEach(vsIdx => {
      const constructors = (mapping.vsConnections[vsIdx] || []).map(i => i + 1).join(' ');
      lines.push(`  ${String(vsIdx + 1).padStart(3)}     1     ${constructors}`);
    });
    lines.push('');
  }

  // [exclusions] — all-vs-all, upper triangle
  lines.push('[exclusions]');
  for (let i = 1; i <= n - 1; i++) {
    const row = Array.from({ length: n - i + 1 }, (_, k) => i + k);
    lines.push(' ' + row.join(' '));
  }

  return lines.join('\n') + '\n';
}

// ── Mapping JSON ──────────────────────────────────────────────────────────────

export function generateMappingJson(mapping) {
  return JSON.stringify(mapping.combinedMappings, null, 2);
}

// ── Download helper ───────────────────────────────────────────────────────────

export function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
