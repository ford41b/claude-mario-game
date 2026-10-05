// Optional: the player can load their own Super Mario Bros. ROM file. Its
// graphics (CHR) and music data are then used instead of this project's
// redrawn tiles and silent music. Nothing from the ROM is shipped with the
// project; the file is kept only in the player's browser (localStorage).
'use strict';

const UserRom = (() => {
  const KEY = 'smb-user-rom';
  const PREFS = 'smb-user-rom-prefs';
  let rom = null; // { prg: Uint8Array(32768), chr: Uint8Array(8192) }
  const prefs = { graphics: true, music: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}')); } catch (e) { /* ignore */ }

  // the project's own artwork, kept so it can be restored
  let own = null;

  function parse(bytes) {
    if (bytes.length < 16 || bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
      throw new Error('This is not an NES ROM file (missing iNES header).');
    }
    const prgSize = bytes[4] * 16384;
    const chrSize = bytes[5] * 8192;
    const trainer = bytes[6] & 0x04 ? 512 : 0;
    if (prgSize !== 32768 || chrSize !== 8192) {
      throw new Error('Unexpected ROM size: this does not look like Super Mario Bros.');
    }
    const start = 16 + trainer;
    if (bytes.length < start + prgSize + chrSize) throw new Error('The ROM file is truncated.');
    const prg = bytes.slice(start, start + prgSize);
    const chr = bytes.slice(start + prgSize, start + prgSize + chrSize);
    // check that the data tables sit where the engine expects them
    const checks = [['PlayerGraphicsTable', 208], ['EnemyGraphicsTable', 258], ['FreqRegLookupTbl', 102],
      ['GroundPaletteData', 36]];
    for (const [name, len] of checks) {
      const at = ROM_LABELS[name];
      for (let i = 0; i < len; i++) {
        if (prg[at + i] !== ROM[L[name] + i]) {
          throw new Error('This ROM is not the original Super Mario Bros. (it may be a different version or a hack).');
        }
      }
    }
    return { prg, chr };
  }

  function decodeChr(chr, base, out) {
    for (let t = 0; t < 256; t++) {
      const o = base + t * 16;
      for (let y = 0; y < 8; y++) {
        const lo = chr[o + y];
        const hi = chr[o + y + 8];
        for (let x = 0; x < 8; x++) {
          const b = 7 - x;
          out[t * 64 + y * 8 + x] = ((lo >> b) & 1) | (((hi >> b) & 1) << 1);
        }
      }
    }
  }

  function apply() {
    if (!own) own = { bg: TILES.bg.slice(), spr: TILES.spr.slice(), title: TITLE_SCREEN_DATA.slice() };
    const useGfx = !!rom && prefs.graphics;
    if (useGfx) {
      decodeChr(rom.chr, 0x0000, TILES.spr);
      decodeChr(rom.chr, 0x1000, TILES.bg);
      TITLE_SCREEN_DATA.length = 0;
      for (let i = 0; i < 0x13a; i++) TITLE_SCREEN_DATA.push(rom.chr[0x1ec0 + i]);
    } else {
      TILES.bg.set(own.bg);
      TILES.spr.set(own.spr);
      TITLE_SCREEN_DATA.length = 0;
      for (const v of own.title) TITLE_SCREEN_DATA.push(v);
    }
    ArtTweaks.retainerMirror = !useGfx;
    RomMusic.setRom(rom && prefs.music ? rom.prg : null);
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  return {
    get loaded() { return !!rom; },
    get graphics() { return prefs.graphics; },
    get music() { return prefs.music; },
    // returns an error message, or null on success
    async loadFile(file) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = parse(bytes);
        rom = parsed;
        try {
          localStorage.setItem(KEY, toBase64(bytes));
        } catch (e) { /* storage full or disabled: works for this session only */ }
        apply();
        return null;
      } catch (e) {
        return e.message;
      }
    },
    restore() {
      try {
        const s = localStorage.getItem(KEY);
        if (s) rom = parse(fromBase64(s));
      } catch (e) {
        rom = null;
      }
      apply();
    },
    forget() {
      rom = null;
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      apply();
    },
    setGraphics(v) { prefs.graphics = !!v; savePrefs(); apply(); },
    setMusic(v) { prefs.music = !!v; savePrefs(); apply(); },
  };
})();
