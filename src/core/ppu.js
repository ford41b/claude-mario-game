// A small model of the NES picture processor, just enough for this game:
// two horizontally arranged nametables (vertical mirroring), palette RAM,
// sprite attribute memory and a scanline renderer with the status-bar split.
//
// Pattern data (the actual tile pixels) comes from src/gfx/tiles.js, which is
// original artwork drawn for this project.
'use strict';

const PPU = {
  nt: new Uint8Array(0x800), // $2000-$27ff
  pal: new Uint8Array(32),
  oam: new Uint8Array(256),
  addr: 0,
  inc32: false,
  // frame snapshot taken during "vblank"
  frame: {
    enabled: false,
    scrollX: 0,
    ntSelect: 0,
    split: false,
  },
};

// 2C02 colour table (RGB). Standard emulator palette.
const NES_RGB = [
  0x666666, 0x002a88, 0x1412a7, 0x3b00a4, 0x5c007e, 0x6e0040, 0x6c0600, 0x561d00,
  0x333500, 0x0b4800, 0x005200, 0x004f08, 0x00404d, 0x000000, 0x000000, 0x000000,
  0xadadad, 0x155fd9, 0x4240ff, 0x7527fe, 0xa01acc, 0xb71e7b, 0xb53120, 0x994e00,
  0x6b6d00, 0x388700, 0x0c9300, 0x008f32, 0x007c8d, 0x000000, 0x000000, 0x000000,
  0xfffeff, 0x64b0ff, 0x9290ff, 0xc676ff, 0xf36aff, 0xfe6ecc, 0xfe8170, 0xea9e22,
  0xbcbe00, 0x88d800, 0x5ce430, 0x45e082, 0x48cdde, 0x4f4f4f, 0x000000, 0x000000,
  0xfffeff, 0xc0dfff, 0xd3d2ff, 0xe8c8ff, 0xfbc2ff, 0xfec4ea, 0xfeccc5, 0xf7d8a5,
  0xe4e594, 0xcfef96, 0xbdf4ab, 0xb3f3cc, 0xb5ebf2, 0xb8b8b8, 0x000000, 0x000000,
];
// little-endian ABGR for ImageData
const NES_ABGR = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  const c = NES_RGB[i];
  NES_ABGR[i] = 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
}

function ppuWrite(addr, v) {
  addr &= 0x3fff;
  if (addr >= 0x3f00) {
    let p = addr & 0x1f;
    if ((p & 0x13) === 0x10) p &= 0x0f; // $3f10/$14/$18/$1c mirror $3f00/$04/$08/$0c
    PPU.pal[p] = v & 0x3f;
  } else if (addr >= 0x2000) {
    // vertical mirroring: $2000=$2800, $2400=$2c00
    PPU.nt[(addr - 0x2000) & 0x7ff] = v;
  }
}
function ppuSetAddr(hi, lo) {
  PPU.addr = ((hi << 8) | lo) & 0x3fff;
}
function ppuData(v) {
  ppuWrite(PPU.addr, v);
  PPU.addr = (PPU.addr + (PPU.inc32 ? 32 : 1)) & 0x3fff;
}

// Port of WriteBufferToScreen / UpdateScreen. `rd(i)` returns byte i of the
// selected VRAM update buffer.
function ppuProcessBuffer(rd) {
  let i = 0;
  for (;;) {
    const hi = rd(i);
    if (hi === 0) break;
    ppuSetAddr(hi, rd(i + 1));
    const ctl = rd(i + 2);
    // WritePPUReg1 also updates the mirror of PPU control register 1
    if (ctl & 0x80) ram[Mirror_PPU_CTRL_REG1] |= 0x04;
    else ram[Mirror_PPU_CTRL_REG1] &= ~0x04 & 0xff;
    PPU.inc32 = (ctl & 0x80) !== 0;
    const repeat = (ctl & 0x40) !== 0;
    let len = ctl & 0x3f;
    if (len === 0) len = 64;
    i += 3;
    if (repeat) {
      const v = rd(i);
      for (let n = 0; n < len; n++) ppuData(v);
      i += 1;
    } else {
      for (let n = 0; n < len; n++) ppuData(rd(i + n));
      i += len;
    }
  }
}

// InitializeNameTables helper: fill one nametable with tile $24 and clear attributes
function ppuClearNametable(base) {
  const o = base - 0x2000;
  for (let n = 0; n < 0x3c0; n++) PPU.nt[o + n] = 0x24;
  for (let n = 0x3c0; n < 0x400; n++) PPU.nt[o + n] = 0;
}

// ------------------------------------------------------------------ renderer

const SCREEN_W = 256;
const SCREEN_H = 240;

// bg pixel colour index (0-3) per screen pixel, used for sprite priority
const bgOpaque = new Uint8Array(SCREEN_W);

function ppuRender(out /* Uint32Array 256*240 */) {
  const f = PPU.frame;
  const pal = PPU.pal;
  const backdrop = NES_ABGR[pal[0] & 0x3f];
  if (!f.enabled) {
    out.fill(backdrop);
    return;
  }
  const nt = PPU.nt;
  const bgChr = TILES.bg; // Uint8Array(256*64), values 0-3
  const sprChr = TILES.spr;
  const oam = PPU.oam;

  // pre-sort sprites per scanline lazily: just scan all 64 for each line
  for (let y = 0; y < SCREEN_H; y++) {
    const rowOff = y * SCREEN_W;
    // background
    let sx, ntSel;
    if (f.split && y < 32) {
      sx = 0;
      ntSel = 0;
    } else {
      sx = f.scrollX;
      ntSel = f.ntSelect;
    }
    const tileRow = y >> 3;
    const fineY = y & 7;
    for (let x = 0; x < SCREEN_W; x++) {
      const wx = x + sx + ntSel * 256; // 0..767
      const ntIndex = (wx >> 8) & 1;
      const lx = wx & 255;
      const col = lx >> 3;
      const base = ntIndex * 0x400;
      const tile = nt[base + tileRow * 32 + col];
      const attr = nt[base + 0x3c0 + (tileRow >> 2) * 8 + (col >> 2)];
      const shift = ((tileRow & 2) << 1) | (col & 2);
      const palHi = (attr >> shift) & 3;
      const pix = bgChr[tile * 64 + fineY * 8 + (lx & 7)];
      bgOpaque[x] = pix;
      out[rowOff + x] = pix === 0 ? backdrop : NES_ABGR[pal[palHi * 4 + pix] & 0x3f];
    }
    // sprite evaluation: the first 8 sprites in OAM order that cover this
    // line are shown, the rest are dropped (the hardware limit that makes
    // sprites flicker when the game rotates their order)
    let found = 0;
    for (let s = 0; s < 64 && found < 8; s++) {
      const sy = oam[s * 4];
      if (sy >= 0xef) continue;
      if (y >= sy + 1 && y < sy + 9) lineSprites[found++] = s;
    }
    // lower OAM index has priority; priority resolved before the BG test
    for (let x = 0; x < SCREEN_W; x++) sprLine[x] = 0;
    for (let n = found - 1; n >= 0; n--) {
      const s = lineSprites[n];
      const o = s * 4;
      const top = oam[o] + 1;
      const tile = oam[o + 1];
      const at = oam[o + 2];
      const sxp = oam[o + 3];
      let py = y - top;
      if (at & 0x80) py = 7 - py;
      const rowBase = tile * 64 + py * 8;
      const p = (at & 3) * 4 + 16;
      const behind = (at & 0x20) !== 0;
      for (let px = 0; px < 8; px++) {
        const xx = sxp + px;
        if (xx >= SCREEN_W) break;
        const bit = sprChr[rowBase + ((at & 0x40) ? 7 - px : px)];
        if (bit === 0) continue;
        // lower-index sprites are drawn last and win the pixel
        sprLine[xx] = 1 | (behind ? 2 : 0) | (pal[p + bit] << 8);
      }
    }
    for (let x = 0; x < SCREEN_W; x++) {
      const v = sprLine[x];
      if (!v) continue;
      if ((v & 2) && bgOpaque[x]) continue;
      out[rowOff + x] = NES_ABGR[(v >> 8) & 0x3f];
    }
  }
}
const sprLine = new Uint32Array(SCREEN_W);
const lineSprites = new Uint8Array(8);
