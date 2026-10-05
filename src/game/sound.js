// Sound engine: port of the original sound-effect routines (square 1, square 2
// and noise SFX, pause jingle) writing to the emulated APU registers.
//
// The background music compositions are copyrighted and are NOT reproduced.
// Instead, MusicHandler keeps the original engine's music *state* (which
// track is playing and how long event jingles last), because the game logic
// waits on it (death sequence, end-of-level timing). Track changes are
// reported to src/core/audio.js, which can play optional user-supplied audio.
'use strict';

const APU_STATUS = 0x4015;

function apuW(reg, v) {
  NesAudio.write(reg, v & 0xff);
}

// Event music lengths in frames, measured from the original engine's note
// length data (time until the square 2 track hits its terminator).
const EventMusicLength = {
  0x01: 180, // death
  0x02: 216, // game over
  0x04: 384, // victory (loops)
  0x08: 364, // castle complete
  0x10: 216, // alternate game over
  0x20: 324, // level complete
  0x40: 168, // time running out (then area music resumes faster)
  0x80: 0, // silence
};

const Music = {
  eventRemaining: 0,
  fast: false,
};

function SoundEngine() {
  if (ram[OperMode] === 0) {
    apuW(APU_STATUS, 0x00);
    return;
  }
  apuW(0x4017, 0xff);
  apuW(APU_STATUS, 0x0f);
  let run = true;
  if (ram[PauseModeFlag] || ram[PauseSoundQueue] === 0x01) {
    run = false;
    // InPause
    let cont = ram[PauseSoundBuffer] !== 0;
    let tone = 0;
    if (!cont) {
      if (ram[PauseSoundQueue]) {
        ram[PauseSoundBuffer] = ram[PauseSoundQueue];
        ram[PauseModeFlag] = ram[PauseSoundQueue];
        apuW(APU_STATUS, 0x00);
        ram[Square1SoundBuffer] = 0;
        ram[Square2SoundBuffer] = 0;
        ram[NoiseSoundBuffer] = 0;
        apuW(APU_STATUS, 0x0f);
        ram[Squ1_SfxLenCounter] = 0x2a;
        tone = 0x44;
      }
    } else {
      const c = ram[Squ1_SfxLenCounter];
      if (c === 0x24 || c === 0x18) tone = 0x64;
      else if (c === 0x1e) tone = 0x44;
    }
    if (cont || tone) {
      if (tone) PlaySqu1Sfx(tone, 0x84, 0x7f);
      // DecPauC
      if (decRam(Squ1_SfxLenCounter) === 0) {
        apuW(APU_STATUS, 0x00);
        if (ram[PauseSoundBuffer] === 0x02) ram[PauseModeFlag] = 0;
        ram[PauseSoundBuffer] = 0;
      }
    }
  }
  if (run) {
    Square1SfxHandler();
    Square2SfxHandler();
    NoiseSfxHandler();
    MusicHandler();
    ram[AreaMusicQueue] = 0;
    ram[EventMusicQueue] = 0;
  }
  ram[Square1SoundQueue] = 0;
  ram[Square2SoundQueue] = 0;
  ram[NoiseSoundQueue] = 0;
  ram[PauseSoundQueue] = 0;
}

// --------------------------------

function Dump_Squ1_Regs(x, y) {
  apuW(0x4001, y);
  apuW(0x4000, x);
}
function PlaySqu1Sfx(a, x, y) {
  Dump_Squ1_Regs(x, y);
  SetFreq_Squ1(a);
}
function SetFreq_Squ1(a) {
  return Dump_Freq_Regs(a, 0x00);
}
function Dump_Freq_Regs(a, x) {
  const lo = ROM[L.FreqRegLookupTbl + a + 1];
  if (lo === 0) return 0;
  apuW(0x4002 + x, lo);
  const hi = ROM[L.FreqRegLookupTbl + a] | 0x08;
  apuW(0x4003 + x, hi);
  return hi;
}
function Dump_Sq2_Regs(x, y) {
  apuW(0x4004, x);
  apuW(0x4005, y);
}
function PlaySqu2Sfx(a, x, y) {
  Dump_Sq2_Regs(x, y);
  SetFreq_Squ2(a);
}
function SetFreq_Squ2(a) {
  return Dump_Freq_Regs(a, 0x04);
}

// --------------------------------

function Square1SfxHandler() {
  const q = ram[Square1SoundQueue];
  if (q) {
    ram[Square1SoundBuffer] = q;
    if (q & 0x80) return JumpRegContents(0x26);
    if (q & 0x01) return JumpRegContents(0x18);
    if (q & 0x02) return Fthrow(0x0a, 0x93);
    if (q & 0x04) return PlaySwimStomp();
    if (q & 0x08) return PlaySmackEnemy();
    if (q & 0x10) return PlayPipeDownInj();
    if (q & 0x20) return Fthrow(0x05, 0x99);
    if (q & 0x40) return PlayFlagpoleSlide();
  }
  const b = ram[Square1SoundBuffer];
  if (b === 0) return;
  if (b & 0x80) return ContinueSndJump();
  if (b & 0x01) return ContinueSndJump();
  if (b & 0x02) return ContinueBumpThrow();
  if (b & 0x04) return ContinueSwimStomp();
  if (b & 0x08) return ContinueSmackEnemy();
  if (b & 0x10) return ContinuePipeDownInj();
  if (b & 0x20) return ContinueBumpThrow();
  if (b & 0x40) return DecrementSfx1Length();
}

function PlayFlagpoleSlide() {
  ram[Squ1_SfxLenCounter] = 0x40;
  SetFreq_Squ1(0x62);
  Dump_Squ1_Regs(0x99, 0xbc);
  DecrementSfx1Length();
}

function JumpRegContents(a) {
  PlaySqu1Sfx(a, 0x82, 0xa7);
  ram[Squ1_SfxLenCounter] = 0x28;
  ContinueSndJump();
}

function ContinueSndJump() {
  const c = ram[Squ1_SfxLenCounter];
  if (c === 0x25) Dump_Squ1_Regs(0x5f, 0xf6);
  else if (c === 0x20) Dump_Squ1_Regs(0x48, 0xbc);
  DecrementSfx1Length();
}

function Fthrow(len, y) {
  ram[Squ1_SfxLenCounter] = len;
  PlaySqu1Sfx(0x0c, 0x9e, y);
  ContinueBumpThrow();
}

function ContinueBumpThrow() {
  if (ram[Squ1_SfxLenCounter] === 0x06) apuW(0x4001, 0xbb);
  DecrementSfx1Length();
}

function PlaySwimStomp() {
  ram[Squ1_SfxLenCounter] = 0x0e;
  PlaySqu1Sfx(0x26, 0x9e, 0x9c);
  ContinueSwimStomp();
}

function ContinueSwimStomp() {
  const y = ram[Squ1_SfxLenCounter];
  apuW(0x4000, ROM[L.SwimStompEnvelopeData - 1 + y]);
  if (y === 0x06) apuW(0x4002, 0x9e);
  DecrementSfx1Length();
}

function PlaySmackEnemy() {
  ram[Squ1_SfxLenCounter] = 0x0e;
  PlaySqu1Sfx(0x28, 0x9f, 0xcb);
  DecrementSfx1Length();
}

function ContinueSmackEnemy() {
  let a = 0x90;
  if (ram[Squ1_SfxLenCounter] === 0x08) {
    apuW(0x4002, 0xa0);
    a = 0x9f;
  }
  apuW(0x4000, a);
  DecrementSfx1Length();
}

function DecrementSfx1Length() {
  if (decRam(Squ1_SfxLenCounter) !== 0) return;
  StopSquare1Sfx();
}

function StopSquare1Sfx() {
  ram[Square1SoundBuffer] = 0;
  apuW(APU_STATUS, 0x0e);
  apuW(APU_STATUS, 0x0f);
}

function PlayPipeDownInj() {
  ram[Squ1_SfxLenCounter] = 0x2f;
  ContinuePipeDownInj();
}

function ContinuePipeDownInj() {
  const c = ram[Squ1_SfxLenCounter];
  if (!(c & 0x01) && !(c & 0x02) && (c & 0x08)) PlaySqu1Sfx(0x44, 0x9a, 0x91);
  DecrementSfx1Length();
}

// --------------------------------

function Square2SfxHandler() {
  if (ram[Square2SoundBuffer] & Sfx_ExtraLife) return ContinueExtraLife();
  const q = ram[Square2SoundQueue];
  if (q) {
    ram[Square2SoundBuffer] = q;
    if (q & 0x80) return PlayBowserFall();
    if (q & 0x01) return CGrab_TTickRegL(0x35, 0x8d);
    if (q & 0x02) return GrowItemRegs(0x10);
    if (q & 0x04) return GrowItemRegs(0x20);
    if (q & 0x08) return PlayBlast();
    if (q & 0x10) return CGrab_TTickRegL(0x06, 0x98);
    if (q & 0x20) return PlayPowerUpGrab();
    if (q & 0x40) return PlayExtraLife();
  }
  const b = ram[Square2SoundBuffer];
  if (b === 0) return;
  if (b & 0x80) return ContinueBowserFall();
  if (b & 0x01) return ContinueCGrabTTick();
  if (b & 0x02) return ContinueGrowItems();
  if (b & 0x04) return ContinueGrowItems();
  if (b & 0x08) return ContinueBlast();
  if (b & 0x10) return ContinueCGrabTTick();
  if (b & 0x20) return ContinuePowerUpGrab();
  if (b & 0x40) return ContinueExtraLife();
}

function CGrab_TTickRegL(len, x) {
  ram[Squ2_SfxLenCounter] = len;
  PlaySqu2Sfx(0x42, x, 0x7f);
  ContinueCGrabTTick();
}

function ContinueCGrabTTick() {
  if (ram[Squ2_SfxLenCounter] === 0x30) apuW(0x4006, 0x54);
  DecrementSfx2Length();
}

function PlayBlast() {
  ram[Squ2_SfxLenCounter] = 0x20;
  PlaySqu2Sfx(0x5e, 0x9f, 0x94);
  DecrementSfx2Length();
}

function ContinueBlast() {
  if (ram[Squ2_SfxLenCounter] === 0x18) PlaySqu2Sfx(0x18, 0x9f, 0x93);
  DecrementSfx2Length();
}

function PlayPowerUpGrab() {
  ram[Squ2_SfxLenCounter] = 0x36;
  ContinuePowerUpGrab();
}

function ContinuePowerUpGrab() {
  const c = ram[Squ2_SfxLenCounter];
  if (!(c & 1)) PlaySqu2Sfx(ROM[L.PowerUpGrabFreqData - 1 + (c >> 1)], 0x5d, 0x7f);
  DecrementSfx2Length();
}

function DecrementSfx2Length() {
  if (decRam(Squ2_SfxLenCounter) !== 0) return;
  EmptySfx2Buffer();
}

function EmptySfx2Buffer() {
  ram[Square2SoundBuffer] = 0;
  StopSquare2Sfx();
}

function StopSquare2Sfx() {
  apuW(APU_STATUS, 0x0d);
  apuW(APU_STATUS, 0x0f);
}

function PlayBowserFall() {
  ram[Squ2_SfxLenCounter] = 0x38;
  PlaySqu2Sfx(0x18, 0x9f, 0xc4);
  DecrementSfx2Length();
}

function ContinueBowserFall() {
  if (ram[Squ2_SfxLenCounter] === 0x08) PlaySqu2Sfx(0x5a, 0x9f, 0xa4);
  DecrementSfx2Length();
}

function PlayExtraLife() {
  ram[Squ2_SfxLenCounter] = 0x30;
  ContinueExtraLife();
}

function ContinueExtraLife() {
  const c = ram[Squ2_SfxLenCounter];
  if (!(c & 0x07)) PlaySqu2Sfx(ROM[L.ExtraLifeFreqData - 1 + (c >> 3)], 0x82, 0x7f);
  DecrementSfx2Length();
}

function GrowItemRegs(len) {
  ram[Squ2_SfxLenCounter] = len;
  apuW(0x4005, 0x7f);
  ram[Sfx_SecondaryCounter] = 0;
  ContinueGrowItems();
}

function ContinueGrowItems() {
  ram[Sfx_SecondaryCounter]++;
  const y = ram[Sfx_SecondaryCounter] >> 1;
  if (y === ram[Squ2_SfxLenCounter]) {
    EmptySfx2Buffer();
    return;
  }
  apuW(0x4004, 0x9d);
  SetFreq_Squ2(ROM[L.PUp_VGrow_FreqData + y]);
}

// --------------------------------

function NoiseSfxHandler() {
  const q = ram[NoiseSoundQueue];
  if (q) {
    ram[NoiseSoundBuffer] = q;
    if (q & 0x01) {
      ram[Noise_SfxLenCounter] = 0x20;
      return ContinueBrickShatter();
    }
    if (q & 0x02) {
      ram[Noise_SfxLenCounter] = 0x40;
      return ContinueBowserFlame();
    }
  }
  const b = ram[NoiseSoundBuffer];
  if (b === 0) return;
  if (b & 0x01) return ContinueBrickShatter();
  if (b & 0x02) return ContinueBowserFlame();
}

function ContinueBrickShatter() {
  const c = ram[Noise_SfxLenCounter];
  if (c & 1) {
    const y = c >> 1;
    PlayNoiseSfx(ROM[L.BrickShatterEnvData + y], ROM[L.BrickShatterFreqData + y]);
    return;
  }
  DecrementSfx3Length();
}

function ContinueBowserFlame() {
  const y = ram[Noise_SfxLenCounter] >> 1;
  PlayNoiseSfx(ROM[L.BowserFlameEnvData - 1 + y], 0x0f);
}

function PlayNoiseSfx(a, x) {
  apuW(0x400c, a);
  apuW(0x400e, x);
  apuW(0x400f, 0x18);
  DecrementSfx3Length();
}

function DecrementSfx3Length() {
  if (decRam(Noise_SfxLenCounter) !== 0) return;
  apuW(0x400c, 0xf0);
  ram[NoiseSoundBuffer] = 0;
}

// --------------------------------
// Music state (timing only).

function MusicHandler() {
  const ev = ram[EventMusicQueue];
  const area = ram[AreaMusicQueue];
  if (ev) {
    LoadEventMusic(ev);
  } else if (area) {
    if (area === UndergroundMusic) StopSquare1Sfx();
    ram[EventMusicBuffer] = 0;
    ram[AreaMusicBuffer] = area;
    Music.eventRemaining = 0;
    NesAudio.music(ram[AreaMusicBuffer], 0, Music.fast);
  } else if (ram[EventMusicBuffer]) {
    if (Music.eventRemaining > 0) Music.eventRemaining--;
    if (Music.eventRemaining === 0) EndOfEventMusic();
  }
}

function LoadEventMusic(a) {
  ram[EventMusicBuffer] = a;
  if (a === DeathMusic) {
    StopSquare1Sfx();
    StopSquare2Sfx();
  }
  ram[AreaMusicBuffer_Alt] = ram[AreaMusicBuffer];
  ram[AreaMusicBuffer] = 0;
  Music.fast = a === TimeRunningOutMusic;
  // lowest set bit selects the track
  let bit = 1;
  while (bit < 0x100 && !(a & bit)) bit <<= 1;
  Music.eventRemaining = EventMusicLength[bit] || 0;
  if (Music.eventRemaining === 0) EndOfEventMusic();
  else NesAudio.music(0, bit, Music.fast);
}

function EndOfEventMusic() {
  const ev = ram[EventMusicBuffer];
  if (ev === TimeRunningOutMusic && ram[AreaMusicBuffer_Alt]) {
    ram[EventMusicBuffer] = 0;
    ram[AreaMusicBuffer] = ram[AreaMusicBuffer_Alt];
    NesAudio.music(ram[AreaMusicBuffer], 0, Music.fast);
    return;
  }
  if (ev & VictoryMusic) {
    LoadEventMusic(VictoryMusic);
    return;
  }
  ram[AreaMusicBuffer] = 0;
  ram[EventMusicBuffer] = 0;
  apuW(0x4008, 0x00);
  apuW(0x4000, 0x90);
  apuW(0x4004, 0x90);
  NesAudio.music(0, 0, Music.fast);
}
