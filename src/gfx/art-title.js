// Title logo: a sign with block letters built from the text font at double
// size, plus a copyright symbol. Uses background tiles the game leaves free.
'use strict';

const TITLE_LOGO = (() => {
  const FREE = [0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde,
    0xdf, 0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf2,
    0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff, 0x42, 0x43, 0x44, 0x46,
    0x48, 0x49, 0x4a, 0x5f, 0x78, 0x7a, 0x95, 0x96, 0x97, 0x98, 0x9a, 0x9f];
  let next = 0;
  const FILL = 0x26; // solid colour 2
  const bg = TILES.bg;
  const tiles = new Map(); // pixel key -> tile number

  // store an 8x8 cell, sharing identical cells
  function cell(px) {
    const key = px.join('');
    if (/^2+$/.test(key)) return FILL;
    if (tiles.has(key)) return tiles.get(key);
    const n = FREE[next++];
    if (n === undefined) throw new Error('title logo: out of tiles');
    Art.tile('bg', n, px.map((v) => String(v)).join('').match(/.{8}/g).map((r) => r.replace(/0/g, '.')), 'title');
    tiles.set(key, n);
    return n;
  }

  // double-size letter from the font tile, with a drop shadow
  function letter(code) {
    const face = [];
    for (let y = 0; y < 16; y++) {
      face.push([]);
      for (let x = 0; x < 16; x++) face[y].push(bg[code * 64 + (y >> 1) * 8 + (x >> 1)] !== 0);
    }
    const out = [];
    for (let y = 0; y < 16; y++) {
      out.push([]);
      for (let x = 0; x < 16; x++) {
        let v = 2;
        if (face[y][x]) v = 1;
        else if ((y > 0 && x > 0 && face[y - 1][x - 1]) || (x > 0 && face[y][x - 1]) || (y > 0 && face[y - 1][x])) v = 3;
        out[y].push(v);
      }
    }
    const q = (ox, oy) => {
      const px = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px.push(out[oy + y][ox + x]);
      return cell(px);
    };
    return [[q(0, 0), q(8, 0)], [q(0, 8), q(8, 8)]];
  }

  const code = (ch) => {
    if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
    if (ch === '.') return 0xaf;
    return 0x24;
  };

  // frame pieces (8x8) for the sign
  const border = (t) => {
    const r = t.trim().split('\n').map((s) => s.trim());
    const px = [];
    for (const row of r) for (const ch of row) px.push(ch === '.' ? 0 : Number(ch));
    return cell(px);
  };
  const TL = border(`
    ..333333
    .3111111
    31111111
    31122222
    31122222
    31122222
    31122222
    31122222`);
  const T = border(`
    33333333
    11111111
    11111111
    22222222
    22222222
    22222222
    22222222
    22222222`);
  const TR = border(`
    333333..
    1111113.
    11111133
    22222333
    22222333
    22222333
    22222333
    22222333`);
  const LE = border(`
    31122222
    31122222
    31122222
    31122222
    31122222
    31122222
    31122222
    31122222`);
  const RE = border(`
    22222333
    22222333
    22222333
    22222333
    22222333
    22222333
    22222333
    22222333`);
  const BL = border(`
    31122222
    31122222
    31122222
    31133333
    31333333
    33333333
    .3333333
    ..333333`);
  const B = border(`
    22222222
    22222222
    22222222
    33333333
    33333333
    33333333
    33333333
    33333333`);
  const BR = border(`
    22222333
    22222333
    22222333
    33333333
    33333333
    33333333
    3333333.
    333333..`);

  // copyright symbol (font colour 1)
  Art.tile('bg', 0xcf, [
    '.11111..',
    '1.....1.',
    '1.111.1.',
    '1.1...1.',
    '1.111.1.',
    '1.....1.',
    '.11111..',
    '........'], 'copyright');

  const W = 24; // tiles
  const Hh = 9;
  const grid = [];
  for (let r = 0; r < Hh; r++) grid.push(new Array(W).fill(FILL));
  for (let c = 0; c < W; c++) {
    grid[0][c] = T;
    grid[Hh - 1][c] = B;
  }
  for (let r = 0; r < Hh; r++) {
    grid[r][0] = LE;
    grid[r][W - 1] = RE;
  }
  grid[0][0] = TL;
  grid[0][W - 1] = TR;
  grid[Hh - 1][0] = BL;
  grid[Hh - 1][W - 1] = BR;
  const write = (text, row, col) => {
    let c = col;
    for (const ch of text) {
      if (ch !== ' ') {
        const t = letter(code(ch));
        grid[row][c] = t[0][0];
        grid[row][c + 1] = t[0][1];
        grid[row + 1][c] = t[1][0];
        grid[row + 1][c + 1] = t[1][1];
      }
      c += ch === '.' || ch === ' ' ? 1 : 2;
    }
  };
  write('SUPER', 2, 2);
  write('MARIO BROS.', 5, 2);

  // "(c)1985 NINTENDO" under the sign, right aligned
  const credit = [0xcf, 1, 9, 8, 5, 0x24, 0x17, 0x12, 0x17, 0x1d, 0x0e, 0x17, 0x0d, 0x18];
  return {
    row: 4,
    col: 4,
    rows: grid.concat([new Array(W - credit.length).fill(0x24).concat(credit)]),
    // palette 1 for the sign, palette 2 (white text) for the menu
    attrs: [[1, 1, 6, 0x55], [2, 1, 6, 0x55], [3, 1, 6, 0x55], [4, 2, 4, 0xaa], [5, 2, 4, 0xaa]],
  };
})();
