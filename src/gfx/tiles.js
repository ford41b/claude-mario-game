// Tile graphics. All artwork in src/gfx/art-*.js is original pixel art drawn
// for this project in the style of the NES game (2 bits per pixel, 8x8 tiles,
// colours chosen by palettes at run time). No graphics data from the original
// cartridge is used.
//
// Art is authored as pictures (strings of '.', '1', '2', '3' = colour 0-3),
// cut into 8x8 cells and stored under the tile numbers the game engine uses.
// A cell can be stored flipped, mirroring how the engine flips sprites.
'use strict';

const TILES = {
  bg: new Uint8Array(256 * 64),
  spr: new Uint8Array(256 * 64),
  defined: { bg: new Uint8Array(256), spr: new Uint8Array(256) },
  conflicts: [],
};

const Art = (() => {
  const table = (name) => (name === 'bg' ? TILES.bg : TILES.spr);

  function parseRows(rows) {
    if (typeof rows === 'string') {
      rows = rows.split('\n').map((r) => r.trim()).filter((r) => r.length);
    }
    return rows.map((r) => [...r].map((ch) => {
      if (ch === '1' || ch === '2' || ch === '3') return ch.charCodeAt(0) - 48;
      return 0;
    }));
  }

  // store one 8x8 cell; flip: 'h', 'v', 'hv' or ''
  function putCell(tbl, tile, px, ox, oy, flip, label) {
    if (tile === null || tile === undefined || tile < 0) return;
    const t = table(tbl);
    const out = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const row = px[oy + y] || [];
        const v = row[ox + x] || 0;
        const tx = flip.includes('h') ? 7 - x : x;
        const ty = flip.includes('v') ? 7 - y : y;
        out[ty * 8 + tx] = v;
      }
    }
    const defined = TILES.defined[tbl];
    if (defined[tile]) {
      for (let i = 0; i < 64; i++) {
        if (t[tile * 64 + i] !== out[i]) {
          TILES.conflicts.push(`${tbl} $${tile.toString(16)} (${label})`);
          break;
        }
      }
    }
    t.set(out, tile * 64);
    defined[tile] = 1;
  }

  // layout: array of rows, each an array of cells. A cell is a tile number,
  // null (unused), or [tile, flip].
  function pic(tbl, layout, rows, label = '') {
    const px = parseRows(rows);
    layout.forEach((cells, r) => {
      cells.forEach((cell, c) => {
        if (cell === null) return;
        const [tile, flip] = Array.isArray(cell) ? cell : [cell, ''];
        putCell(tbl, tile, px, c * 8, r * 8, flip, label);
      });
    });
  }

  function tile(tbl, num, rows, label = '') {
    putCell(tbl, num, parseRows(rows), 0, 0, '', label);
  }

  // a row of single tiles drawn side by side in one picture
  function strip(tbl, nums, rows, label = '') {
    pic(tbl, [nums], rows, label);
  }

  function copy(tbl, from, to) {
    const t = table(tbl);
    t.copyWithin(to * 64, from * 64, from * 64 + 64);
    TILES.defined[tbl][to] = 1;
  }

  function fill(tbl, num, color) {
    table(tbl).fill(color, num * 64, num * 64 + 64);
    TILES.defined[tbl][num] = 1;
  }

  // give any tile that has no artwork a visible placeholder pattern
  function finish() {
    for (const tbl of ['bg', 'spr']) {
      const t = table(tbl);
      const missing = [];
      for (let n = 0; n < 256; n++) {
        if (TILES.defined[tbl][n]) continue;
        missing.push(n);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const edge = x === 0 || y === 0 || x === 7 || y === 7;
            t[n * 64 + y * 8 + x] = edge ? 3 : ((x ^ y) & 2 ? 1 : 2);
          }
        }
      }
      TILES.missing = TILES.missing || {};
      TILES.missing[tbl] = missing;
    }
  }

  return { pic, tile, strip, copy, fill, finish };
})();
