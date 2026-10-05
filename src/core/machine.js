// Machine state shared by the game logic.
//
// The game logic is a hand-written JavaScript port of the original program's
// routines (names follow the community disassembly). It keeps the original's
// 2KB work RAM layout so that every variable, table offset and aliasing quirk
// behaves exactly as on the console.
'use strict';

const ram = new Uint8Array(0x800);

// 6502 carry flag, used where the original code relies on carry across
// instructions (multi-byte adds, compare results passed between routines).
let C = 0;

// ADC / SBC / CMP equivalents. All values are bytes (0-255).
function adc(a, b) {
  const r = a + b + C;
  C = r > 0xff ? 1 : 0;
  return r & 0xff;
}
function sbc(a, b) {
  const r = a - b - (C ^ 1);
  C = r >= 0 ? 1 : 0;
  return r & 0xff;
}
// CLC; ADC
function add(a, b) {
  C = 0;
  return adc(a, b);
}
// SEC; SBC
function sub(a, b) {
  C = 1;
  return sbc(a, b);
}
// CMP: sets carry (a >= b) and returns the 8-bit difference for N/Z tests.
function cmp(a, b) {
  C = a >= b ? 1 : 0;
  return (a - b) & 0xff;
}
// ASL / LSR / ROL / ROR on a byte, updating carry.
function asl(v) {
  C = (v >> 7) & 1;
  return (v << 1) & 0xff;
}
function lsr(v) {
  C = v & 1;
  return v >> 1;
}
function rol(v) {
  const c = C;
  C = (v >> 7) & 1;
  return ((v << 1) | c) & 0xff;
}
function ror(v) {
  const c = C;
  C = v & 1;
  return (v >> 1) | (c << 7);
}
// sign test helpers
const neg = (v) => (v & 0x80) !== 0;
const pos = (v) => (v & 0x80) === 0;
// two's complement of a byte
const twos = (v) => (-v) & 0xff;

// read a 16-bit little-endian pointer stored in RAM
const ptr = (addr) => ram[addr] | (ram[addr + 1] << 8);

function incRam(addr) {
  ram[addr] = (ram[addr] + 1) & 0xff;
  return ram[addr];
}
function decRam(addr) {
  ram[addr] = (ram[addr] - 1) & 0xff;
  return ram[addr];
}
