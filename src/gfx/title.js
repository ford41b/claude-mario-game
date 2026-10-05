// Title screen nametable data in the game's VRAM update buffer format:
// [address high, address low, control (bit 7: +32 step, bit 6: repeat,
// bits 0-5: length), data...] ... terminated by 0.
//
// The original game keeps this image in its graphics ROM. This is a new
// layout: the logo is built from original tiles drawn in src/gfx/art-title.js.
'use strict';

const TITLE_SCREEN_DATA = (() => {
  const out = [];
  const text = (s) => [...s].map((ch) => {
    if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
    if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
    if (ch === '-') return 0x28;
    if (ch === '.') return 0xaf;
    if (ch === '!') return 0x2b;
    return 0x24;
  });
  const put = (row, col, bytes) => {
    const addr = 0x2000 + row * 32 + col;
    out.push(addr >> 8, addr & 0xff, bytes.length, ...bytes);
  };
  const attr = (row, col, len, value) => {
    const addr = 0x23c0 + row * 8 + col;
    out.push(addr >> 8, addr & 0xff, 0x40 | len, value);
  };

  if (typeof TITLE_LOGO === 'object' && TITLE_LOGO) {
    TITLE_LOGO.rows.forEach((tiles, r) => put(TITLE_LOGO.row + r, TITLE_LOGO.col, tiles));
    for (const a of TITLE_LOGO.attrs) attr(a[0], a[1], a[2], a[3]);
  } else {
    put(8, 8, text('SUPER MARIO BROS.'));
  }
  put(18, 11, text('1 PLAYER GAME'));
  put(20, 11, text('2 PLAYER GAME'));
  put(23, 12, text('TOP-'));
  put(23, 22, text('0'));
  out.push(0);
  return out;
})();
