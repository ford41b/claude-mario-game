// Computes the ROM addresses of labels in the SMB disassembly by sizing every
// instruction and data directive (no code is generated). The output only
// contains addresses, which the optional "use your own ROM" feature needs to
// find the original music data and title screen inside a user-supplied file.
//
// Usage: node tools/asm-labels.mjs <path-to-smb1-disassembly>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/asm-labels.mjs <smb1 disassembly dir>');
  process.exit(1);
}
const outFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'romlabels.js');

const symbols = new Map();
const labels = new Map();
let pc = 0;
let inEnum = false;

function value(expr) {
  expr = expr.trim();
  const tokens = expr.match(/\$[0-9a-fA-F]+|%[01]+|\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/<>()]/g) || [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function atom() {
    const t = next();
    if (t === undefined) throw new Error('bad expr ' + expr);
    if (t === '<') return atom() & 0xff;
    if (t === '>') return (atom() >> 8) & 0xff;
    if (t === '-') return -atom();
    if (t === '(') { const v = sum(); next(); return v; }
    if (t[0] === '$') return parseInt(t.slice(1), 16);
    if (t[0] === '%') return parseInt(t.slice(1), 2);
    if (/^\d/.test(t)) return parseInt(t, 10);
    if (symbols.has(t)) return symbols.get(t);
    if (labels.has(t)) return labels.get(t);
    return undefined;
  }
  function prod() {
    let v = atom();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const w = atom();
      v = v === undefined || w === undefined ? undefined : op === '*' ? v * w : Math.floor(v / w);
    }
    return v;
  }
  function sum() {
    let v = prod();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const w = prod();
      v = v === undefined || w === undefined ? undefined : op === '+' ? v + w : v - w;
    }
    return v;
  }
  return sum();
}

const BRANCH = new Set(['BCC', 'BCS', 'BEQ', 'BMI', 'BNE', 'BPL', 'BVC', 'BVS']);
const IMPLIED = new Set(['BRK', 'CLC', 'CLD', 'CLI', 'CLV', 'DEX', 'DEY', 'INX', 'INY', 'NOP', 'PHA', 'PHP',
  'PLA', 'PLP', 'RTI', 'RTS', 'SEC', 'SED', 'SEI', 'TAX', 'TAY', 'TSX', 'TXA', 'TXS', 'TYA']);
const ACCUM = new Set(['ASL', 'LSR', 'ROL', 'ROR']);
// instructions with a zero page,Y mode
const ZPY = new Set(['LDX', 'STX']);
// instructions without any zero page,X mode
const NO_ZPX = new Set(['LDX', 'STX', 'JMP', 'JSR', 'CPX', 'CPY', 'BIT']);

function instrSize(mn, operand) {
  mn = mn.toUpperCase();
  operand = (operand || '').trim();
  if (IMPLIED.has(mn)) return 1;
  if (ACCUM.has(mn) && (operand === '' || operand.toUpperCase() === 'A')) return 1;
  if (BRANCH.has(mn)) return 2;
  if (mn === 'JMP' || mn === 'JSR') return 3;
  if (operand.startsWith('#')) return 2;
  if (operand.startsWith('(')) return 2; // (zp),Y or (zp,X)
  let force16 = false;
  if (/^a:/i.test(operand)) { force16 = true; operand = operand.slice(2); }
  const m = operand.match(/^(.*?)(?:,\s*([xyXY]))?$/);
  const base = m[1];
  const idx = (m[2] || '').toUpperCase();
  const v = value(base);
  const zp = !force16 && v !== undefined && v >= 0 && v < 0x100;
  if (idx === 'Y') return zp && ZPY.has(mn) ? 2 : 3;
  if (idx === 'X') return zp && !NO_ZPX.has(mn) ? 2 : 3;
  return zp ? 2 : 3;
}

function dataCount(args) {
  // split on commas outside quotes
  const parts = [];
  let cur = '', q = false;
  for (const ch of args) {
    if (ch === '"') q = !q;
    if (ch === ',' && !q) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  let n = 0;
  for (const p of parts) {
    const t = p.trim();
    n += t.startsWith('"') ? t.length - 2 : 1;
  }
  return n;
}

function processFile(path) {
  const text = readFileSync(join(src, path), 'utf8');
  for (let raw of text.split('\n')) {
    let line = raw.replace(/;.*$/, '').trimEnd();
    if (!line.trim()) continue;
    // symbol definitions
    let m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (m) { const v = value(m[2]); if (v !== undefined) symbols.set(m[1], v); continue; }
    // label
    m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):(.*)$/);
    if (m) {
      if (inEnum) symbols.set(m[1], pc); else labels.set(m[1], pc);
      line = m[2];
      if (!line.trim()) continue;
    }
    const t = line.trim();
    m = t.match(/^\.(\w+)\s*(.*)$/);
    if (m) {
      const d = m[1].toLowerCase();
      const args = m[2];
      if (d === 'include') processFile(args.replace(/"/g, '').trim());
      else if (d === 'enum') { inEnum = true; pc = value(args); }
      else if (d === 'ende') { inEnum = false; }
      else if (d === 'base') pc = value(args);
      else if (d === 'db' || d === 'byte') pc += dataCount(args);
      else if (d === 'dw' || d === 'word') pc += 2 * dataCount(args);
      else if (d === 'dsb') pc += value(args.split(',')[0]);
      else if (d === 'dsw') pc += 2 * value(args.split(',')[0]);
      else if (d === 'incbin') { /* CHR follows PRG */ }
      else throw new Error('unknown directive ' + d);
      continue;
    }
    m = t.match(/^([A-Za-z]{3})\b\s*(.*)$/);
    if (m) { pc += instrSize(m[1], m[2]); continue; }
    throw new Error('cannot parse: ' + raw);
  }
}

// two passes so forward references get their values
for (let pass = 0; pass < 2; pass++) {
  pc = 0;
  processFile('smb1.asm');
}
if (pc !== 0x10000) throw new Error('PRG size check failed: ended at $' + pc.toString(16));

const wanted = ['MusicHeaderData', 'MusicLengthLookupTbl', 'EndOfCastleMusicEnvData',
  'AreaMusicEnvData', 'WaterEventMusEnvData', 'FreqRegLookupTbl', 'PlayerGraphicsTable',
  'EnemyGraphicsTable', 'GroundPaletteData'];
const out = {};
for (const w of wanted) {
  if (!labels.has(w)) throw new Error('missing label ' + w);
  out[w] = labels.get(w) - 0x8000; // offset into PRG
}
writeFileSync(outFile, `// Generated by tools/asm-labels.mjs: offsets of labels inside the 32 KB
// program ROM of Super Mario Bros. (addresses only, no ROM contents).
'use strict';

const ROM_LABELS = Object.freeze(${JSON.stringify(out, null, 2)});
`);
console.log('ok: PRG ends at $10000;', Object.entries(out).map(([k, v]) => `${k}=$${(v + 0x8000).toString(16)}`).join(' '));
