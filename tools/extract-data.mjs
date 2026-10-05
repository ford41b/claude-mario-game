// Extracts the data tables (not code) used by the game logic from the community
// SMB disassembly (doppelganger's SMBDIS, asm6f form at github.com/Xkeeper0/smb1)
// and writes them as plain JavaScript data:
//
//   src/data/romdata.js  - flat byte array of every labeled .db table + label offsets
//   src/core/ramdefs.js  - RAM variable addresses and game constants
//
// Usage: node tools/extract-data.mjs <path-to-smb1-disassembly>
//
// Music data (src/music-data.asm) is deliberately NOT extracted. CHR graphics are
// never read. Only level layouts, object/enemy tables and engine constants are used.

import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/extract-data.mjs <path-to-smb1-disassembly>');
  process.exit(1);
}

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---------------------------------------------------------------- constants
const consts = new Map();
function parseDefs(text) {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!m) continue;
    consts.set(m[1], m[2].trim());
  }
}
parseDefs(read('src/defs.asm'));
parseDefs(read('src/ram.asm'));

// ---------------------------------------------------------------- source lines in include order
function expand(file) {
  const out = [];
  for (const raw of read(file).split('\n')) {
    const inc = raw.match(/^\s*\.include\s+"([^"]+)"/);
    if (inc) {
      if (/music-data|music-engine/.test(inc[1])) {
        // music engine is scanned separately for SFX tables only
        if (/music-engine/.test(inc[1])) out.push(...expand(inc[1]).map((l) => l));
        continue;
      }
      out.push(...expand(inc[1]));
      continue;
    }
    out.push(raw);
  }
  return out;
}
const lines = expand('src/prg.asm');

// ---------------------------------------------------------------- split into labeled blocks
const blocks = []; // {labels:[], lines:[]}
let cur = null;
for (const raw of lines) {
  const line = raw.replace(/;.*$/, '');
  const lm = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
  if (lm) {
    if (cur && cur.lines.length === 0) cur.labels.push(lm[1]);
    else {
      cur = { labels: [lm[1]], lines: [] };
      blocks.push(cur);
    }
    if (lm[2].trim()) cur.lines.push(lm[2].trim());
    continue;
  }
  if (!cur) continue;
  if (line.trim()) cur.lines.push(line.trim());
}

// From music-data.asm only the note period table and the two noise-SFX envelopes are
// taken (they are used by sound effects). Music sequence data is never read.
{
  const allow = new Set(['FreqRegLookupTbl', 'BowserFlameEnvData', 'BrickShatterEnvData']);
  let take = null;
  for (const raw of read('src/music-data.asm').split('\n')) {
    const line = raw.replace(/;.*$/, '');
    const lm = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*$/);
    if (lm) {
      take = allow.has(lm[1]) ? { labels: [lm[1]], lines: [] } : null;
      if (take) blocks.push(take);
      continue;
    }
    if (take && /^\s*\.db\s/i.test(line)) take.lines.push(line.trim());
    else if (take && line.trim()) take = null;
  }
}

// a block is data if every line is a .db directive
const isData = (b) => b.lines.length > 0 && b.lines.every((l) => /^\.db\s/i.test(l));

// Music sequence data is excluded; the following labels in the sound engine are the
// music player's own tables and are not needed.
const skipLabels = new Set(['MusicLengthLookupTbl']);

// ---------------------------------------------------------------- first pass: offsets
const labelOfs = new Map();
let ofs = 0;
const dataBlocks = blocks.filter((b) => isData(b) && !b.labels.some((l) => skipLabels.has(l)));
const countItems = (l) => splitItems(l.replace(/^\.db\s+/i, '')).length;
function splitItems(s) {
  return s.split(',').map((x) => x.trim()).filter((x) => x.length);
}
for (const b of dataBlocks) {
  for (const l of b.labels) labelOfs.set(l, ofs);
  for (const l of b.lines) ofs += countItems(l);
}

// ---------------------------------------------------------------- expression evaluation
function evalExpr(e) {
  e = e.trim();
  if (e.startsWith('<')) return evalExpr(e.slice(1)) & 0xff;
  if (e.startsWith('>')) return (evalExpr(e.slice(1)) >> 8) & 0xff;
  // binary +/- (left to right)
  const parts = e.split(/([+-])/).map((p) => p.trim()).filter((p) => p.length);
  if (parts.length > 1) {
    let v = term(parts[0]);
    for (let i = 1; i < parts.length; i += 2) {
      const t = term(parts[i + 1]);
      v = parts[i] === '+' ? v + t : v - t;
    }
    return v;
  }
  return term(e);
}
function term(t) {
  if (/^\$[0-9a-f]+$/i.test(t)) return parseInt(t.slice(1), 16);
  if (/^%[01]+$/.test(t)) return parseInt(t.slice(1), 2);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  if (labelOfs.has(t)) return labelOfs.get(t);
  if (consts.has(t)) return evalExpr(consts.get(t));
  throw new Error('unknown term: ' + t);
}

// ---------------------------------------------------------------- second pass: bytes
const bytes = [];
for (const b of dataBlocks) {
  for (const l of b.lines) {
    for (const item of splitItems(l.replace(/^\.db\s+/i, ''))) {
      const v = evalExpr(item);
      bytes.push(v & 0xff);
    }
  }
}
if (bytes.length > 0xffff) throw new Error('data image too large');

// ---------------------------------------------------------------- write romdata.js
const labels = [...labelOfs.entries()].sort((a, b) => a[1] - b[1]);
let js = '';
js += '// GENERATED by tools/extract-data.mjs from the SMB disassembly - do not edit by hand.\n';
js += '// Flat image of the game\'s data tables (level layouts, enemy data, object tables,\n';
js += '// physics constants). Code reads them as ROM[L.TableName + index].\n';
js += "'use strict';\n";
js += 'const ROM = new Uint8Array([\n';
for (let i = 0; i < bytes.length; i += 24) {
  js += '  ' + bytes.slice(i, i + 24).map((v) => '0x' + v.toString(16).padStart(2, '0')).join(',') + ',\n';
}
js += ']);\n';
js += 'const L = Object.freeze({\n';
for (const [name, o] of labels) js += `  ${name}: ${o},\n`;
js += '});\n';
fs.writeFileSync('src/data/romdata.js', js);

// ---------------------------------------------------------------- write ramdefs.js
let rj = '';
rj += '// GENERATED by tools/extract-data.mjs from the SMB disassembly (ram.asm/defs.asm).\n';
rj += '// RAM variable addresses and engine constants, using the disassembly\'s names.\n';
rj += "'use strict';\n";
const skipConst = /^(PPU_|SND_|SPR_DMA|JOYPAD_|WarmBootOffset|ColdBootOffset|TitleScreenDataOffset|SwimTileRepOffset|MusicHeaderOffsetData|MHD$)/;
for (const [name, val] of consts) {
  if (skipConst.test(name)) continue;
  let v;
  try { v = evalExpr(val); } catch (e) { continue; }
  rj += `const ${name} = 0x${v.toString(16)};\n`;
}
rj += `const SwimTileRepOffset = ${labelOfs.get('PlayerGraphicsTable') + 0x9e}; // ROM offset\n`;
fs.writeFileSync('src/core/ramdefs.js', rj);

console.log(`romdata: ${bytes.length} bytes, ${labels.length} labels`);
