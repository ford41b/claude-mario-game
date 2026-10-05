// Music engine: port of the original music routines (MusicHandler through
// LoadEnvelopeData). The note data is not part of this project; it is read
// from a Super Mario Bros. ROM file the player supplies (src/core/userrom.js).
// Without one, sound.js keeps only the music timing.
'use strict';

const RomMusic = (() => {
  let prg = null;
  const lab = () => ROM_LABELS;
  const P = (off) => prg[off];
  const mdata = (y) => {
    const addr = ram[MusicDataLow] | (ram[MusicDataHigh] << 8);
    return prg[(addr + y - 0x8000) & 0x7fff];
  };

  function MusicHandler() {
    let a = ram[EventMusicQueue];
    if (a) return LoadEventMusic(a);
    a = ram[AreaMusicQueue];
    if (a) return LoadAreaMusic(a);
    if (ram[EventMusicBuffer] | ram[AreaMusicBuffer]) HandleSquare2Music();
  }

  function LoadEventMusic(a) {
    ram[EventMusicBuffer] = a;
    if (a === DeathMusic) {
      StopSquare1Sfx();
      StopSquare2Sfx();
    }
    ram[AreaMusicBuffer_Alt] = ram[AreaMusicBuffer];
    ram[NoteLengthTblAdder] = 0;
    ram[AreaMusicBuffer] = 0;
    if (a === TimeRunningOutMusic) ram[NoteLengthTblAdder] = 0x08;
    FindMusicHeader(a, 0);
  }

  function LoadAreaMusic(a) {
    if (a === 0x04) StopSquare1Sfx();
    ram[GroundMusicHeaderOfs] = 0x10;
    HandleAreaMusicLoopB(a);
  }

  function HandleAreaMusicLoopB(a) {
    ram[EventMusicBuffer] = 0;
    ram[AreaMusicBuffer] = a;
    if (a === 0x01) {
      ram[GroundMusicHeaderOfs]++;
      let y = ram[GroundMusicHeaderOfs];
      if (y === 0x32) {
        ram[GroundMusicHeaderOfs] = 0x11;
        ram[GroundMusicHeaderOfs]++;
        y = ram[GroundMusicHeaderOfs];
      }
      return LoadHeader(y);
    }
    ram[MusicOffset_Square2] = 0x08; // residual instruction in the original
    FindMusicHeader(a, 0x08);
  }

  function FindMusicHeader(a, y) {
    // increment Y once per bit shifted out until a set bit is found
    do {
      y++;
      const c = a & 1;
      a >>= 1;
      if (c) break;
    } while (y < 0x100);
    LoadHeader(y & 0xff);
  }

  function LoadHeader(y) {
    const hdr = lab().MusicHeaderData;
    const ofs = P(hdr + y - 1); // MusicHeaderOffsetData = MusicHeaderData - 1
    ram[NoteLenLookupTblOfs] = P(hdr + ofs);
    ram[MusicDataLow] = P(hdr + ofs + 1);
    ram[MusicDataHigh] = P(hdr + ofs + 2);
    ram[MusicOffset_Triangle] = P(hdr + ofs + 3);
    ram[MusicOffset_Square1] = P(hdr + ofs + 4);
    ram[MusicOffset_Noise] = P(hdr + ofs + 5);
    ram[NoiseDataLoopbackOfs] = P(hdr + ofs + 5);
    ram[Squ2_NoteLenCounter] = 1;
    ram[Squ1_NoteLenCounter] = 1;
    ram[Tri_NoteLenCounter] = 1;
    ram[Noise_BeatLenCounter] = 1;
    ram[MusicOffset_Square2] = 0;
    ram[AltRegContentFlag] = 0;
    apuW(0x4015, 0x0b);
    apuW(0x4015, 0x0f);
    HandleSquare2Music();
  }

  function fetch(off) {
    const y = ram[off];
    ram[off] = (y + 1) & 0xff;
    return mdata(y);
  }

  function HandleSquare2Music() {
    if (decRam(Squ2_NoteLenCounter) === 0) {
      let a = fetch(MusicOffset_Square2);
      if (a === 0) return EndOfMusicData();
      if (a & 0x80) {
        ram[Squ2_NoteLenBuffer] = ProcessLengthData(a);
        a = fetch(MusicOffset_Square2);
      }
      // Squ2NoteHandler
      if (!ram[Square2SoundBuffer]) {
        let x = 0x04, yy = a, env;
        if (SetFreq_Squ2(a) === 0) {
          env = 0; // rest: A is zero, X/Y keep the frequency routine's values
        } else {
          [env, x, yy] = LoadControlRegs();
        }
        ram[Squ2_EnvelopeDataCtrl] = env;
        Dump_Sq2_Regs(x, yy);
      }
      ram[Squ2_NoteLenCounter] = ram[Squ2_NoteLenBuffer];
    }
    // MiscSqu2MusicTasks
    if (!ram[Square2SoundBuffer] && !(ram[EventMusicBuffer] & 0x91)) {
      // the offset is read before it is decremented
      const y = ram[Squ2_EnvelopeDataCtrl];
      if (y) ram[Squ2_EnvelopeDataCtrl]--;
      apuW(0x4004, LoadEnvelopeData(y));
      apuW(0x4005, 0x7f);
    }
    HandleSquare1Music();
  }

  function EndOfMusicData() {
    const ev = ram[EventMusicBuffer];
    if (ev === TimeRunningOutMusic && ram[AreaMusicBuffer_Alt]) return HandleAreaMusicLoopB(ram[AreaMusicBuffer_Alt]);
    if (ev & VictoryMusic) return LoadEventMusic(VictoryMusic);
    if (ram[AreaMusicBuffer] & 0x5f) return HandleAreaMusicLoopB(ram[AreaMusicBuffer]);
    ram[AreaMusicBuffer] = 0;
    ram[EventMusicBuffer] = 0;
    apuW(0x4008, 0x00);
    apuW(0x4000, 0x90);
    apuW(0x4004, 0x90);
  }

  function HandleSquare1Music() {
    if (ram[MusicOffset_Square1]) {
      if (decRam(Squ1_NoteLenCounter) === 0) {
        let a;
        for (;;) {
          a = fetch(MusicOffset_Square1);
          if (a) break;
          apuW(0x4000, 0x83);
          apuW(0x4001, 0x94);
          ram[AltRegContentFlag] = 0x94;
        }
        const [len, x] = AlternateLengthHandler(a);
        ram[Squ1_NoteLenCounter] = len;
        if (!ram[Square1SoundBuffer]) {
          const note = x & 0x3e;
          let rx = 0x00, ry = note, env;
          if (SetFreq_Squ1(note) === 0) env = 0;
          else [env, rx, ry] = LoadControlRegs();
          ram[Squ1_EnvelopeDataCtrl] = env;
          Dump_Squ1_Regs(rx, ry);
        } else {
          return HandleTriangleMusic();
        }
      }
      // MiscSqu1MusicTasks
      if (!ram[Square1SoundBuffer]) {
        if (!(ram[EventMusicBuffer] & 0x91)) {
          const y = ram[Squ1_EnvelopeDataCtrl];
          if (y) ram[Squ1_EnvelopeDataCtrl]--;
          apuW(0x4000, LoadEnvelopeData(y));
        }
        apuW(0x4001, ram[AltRegContentFlag] || 0x7f);
      }
    }
    HandleTriangleMusic();
  }

  function HandleTriangleMusic() {
    if (decRam(Tri_NoteLenCounter) === 0) {
      let a = fetch(MusicOffset_Triangle);
      let ctrl = null;
      if (a === 0) ctrl = 0;
      else {
        if (a & 0x80) {
          ram[Tri_NoteLenBuffer] = ProcessLengthData(a);
          apuW(0x4008, 0x1f);
          a = fetch(MusicOffset_Triangle);
          if (a === 0) ctrl = 0;
        }
        if (ctrl === null) {
          // TriNoteHandler
          Dump_Freq_Regs(a, 0x08);
          const x = ram[Tri_NoteLenBuffer];
          ram[Tri_NoteLenCounter] = x;
          if ((ram[EventMusicBuffer] & 0x6e) || (ram[AreaMusicBuffer] & 0x0a)) {
            if (x >= 0x12) ctrl = 0xff;
            else if (ram[EventMusicBuffer] & EndOfCastleMusic) ctrl = 0x0f;
            else ctrl = 0x1f;
          }
        }
      }
      if (ctrl !== null) apuW(0x4008, ctrl);
    }
    HandleNoiseMusic();
  }

  function HandleNoiseMusic() {
    if (!(ram[AreaMusicBuffer] & 0xf3)) return;
    if (decRam(Noise_BeatLenCounter) !== 0) return;
    let a;
    for (;;) {
      a = fetch(MusicOffset_Noise);
      if (a) break;
      ram[MusicOffset_Noise] = ram[NoiseDataLoopbackOfs];
    }
    const [len, x] = AlternateLengthHandler(a);
    ram[Noise_BeatLenCounter] = len;
    const b = x & 0x3e;
    let r0, r2 = 0, r3 = 0, silent = false;
    if (b === 0) silent = true;
    else if (b === 0x30) { r0 = 0x1c; r2 = 0x03; r3 = 0x58; }
    else if (b === 0x20) { r0 = 0x1c; r2 = 0x0c; r3 = 0x18; }
    else if (b & 0x10) { r0 = 0x1c; r2 = 0x03; r3 = 0x18; }
    else silent = true;
    if (silent) {
      // SilentBeat: only A changes; X and Y keep the length handler's values
      r0 = 0x10;
      r2 = x;
      r3 = lastLenIndex; // Y as left by ProcessLengthData

    }
    apuW(0x400c, r0);
    apuW(0x400e, r2);
    apuW(0x400f, r3);
  }

  let lastLenIndex = 0;

  // returns [length, original byte]
  function AlternateLengthHandler(a) {
    const x = a;
    // ROR then ROL x3: turns xx00000x into 00000xxx
    const v = ((a << 2) & 0x04) | ((a >> 6) & 0x03);
    return [ProcessLengthData(v), x];
  }

  function ProcessLengthData(a) {
    const y = ((a & 0x07) + ram[NoteLenLookupTblOfs] + ram[NoteLengthTblAdder]) & 0xff;
    lastLenIndex = y;
    return P(lab().MusicLengthLookupTbl + y);
  }

  // returns [A, X, Y]
  function LoadControlRegs() {
    let a;
    if (ram[EventMusicBuffer] & EndOfCastleMusic) a = 0x04;
    else if (ram[AreaMusicBuffer] & 0x7d) a = 0x08;
    else a = 0x28;
    return [a, 0x82, 0x7f];
  }

  function LoadEnvelopeData(y) {
    if (ram[EventMusicBuffer] & EndOfCastleMusic) return P(lab().EndOfCastleMusicEnvData + y);
    if (ram[AreaMusicBuffer] & 0x7d) return P(lab().AreaMusicEnvData + y);
    return P(lab().WaterEventMusEnvData + y);
  }

  return {
    get enabled() { return prg !== null; },
    setRom(p) { prg = p; },
    MusicHandler,
  };
})();
