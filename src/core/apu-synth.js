// NES APU synthesizer (2 pulse, triangle, noise) used to render the game's
// sound effects. It receives the register writes made by the sound engine each
// video frame and applies them one frame at a time at a steady 60.1 Hz, so
// effects keep their original frame-by-frame timing. Band-limited by
// integrating each channel's output over every audio sample period.
//
// This file is loaded both on the main thread (ScriptProcessor fallback) and
// inside an AudioWorklet (via NesApu.toString()), so it must be self-contained.
'use strict';

class NesApu {
  constructor(sampleRate) {
    const CPU = 1789773;
    this.cpuPerSample = CPU / sampleRate;
    this.frameCycles = CPU / 60.0988;
    this.LEN = [10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
      12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30];
    this.DUTY = [
      [0, 1, 0, 0, 0, 0, 0, 0],
      [0, 1, 1, 0, 0, 0, 0, 0],
      [0, 1, 1, 1, 1, 0, 0, 0],
      [1, 0, 0, 1, 1, 1, 1, 1],
    ];
    this.NOISE = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
    this.TRI = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const mkPulse = (n) => ({
      n, enabled: false, duty: 0, halt: false, constVol: false, vol: 0,
      period: 0, len: 0, seq: 0, timer: 2,
      envStart: false, envDiv: 0, envDecay: 0,
      swEn: false, swPeriod: 0, swNeg: false, swShift: 0, swDiv: 0, swReload: false,
    });
    this.p = [mkPulse(1), mkPulse(2)];
    this.t = { enabled: false, ctrl: false, linReload: 0, lin: 0, linFlag: false, period: 0, len: 0, seq: 0, timer: 1 };
    this.nz = { enabled: false, halt: false, constVol: false, vol: 0, mode: 0, period: 4, len: 0, lfsr: 1, timer: 4,
      envStart: false, envDiv: 0, envDecay: 0 };
    this.seqCycle = 0;
    this.dmc = 0;
    this.queue = [];
    this.started = false;
    this.starved = 0;
    this.cycle = 0;
    this.nextFrame = 0;
    this.hpPrevIn = 0;
    this.hpPrevOut = 0;
    this.hpPrevIn2 = 0;
    this.hpPrevOut2 = 0;
    this.lp = 0;
    this.volume = 0.8;
    this.muted = false;
  }

  push(batch) {
    this.queue.push(batch);
    if (this.queue.length > 8) this.queue.splice(0, this.queue.length - 4);
  }

  write(reg, v) {
    switch (reg) {
      case 0x4000: case 0x4004: {
        const c = this.p[(reg - 0x4000) >> 2];
        c.duty = v >> 6; c.halt = (v & 0x20) !== 0; c.constVol = (v & 0x10) !== 0; c.vol = v & 0x0f;
        break;
      }
      case 0x4001: case 0x4005: {
        const c = this.p[(reg - 0x4001) >> 2];
        c.swEn = (v & 0x80) !== 0; c.swPeriod = (v >> 4) & 7; c.swNeg = (v & 0x08) !== 0; c.swShift = v & 7;
        c.swReload = true;
        break;
      }
      case 0x4002: case 0x4006: {
        const c = this.p[(reg - 0x4002) >> 2];
        c.period = (c.period & 0x700) | v;
        break;
      }
      case 0x4003: case 0x4007: {
        const c = this.p[(reg - 0x4003) >> 2];
        c.period = (c.period & 0xff) | ((v & 7) << 8);
        if (c.enabled) c.len = this.LEN[v >> 3];
        c.seq = 0;
        c.envStart = true;
        break;
      }
      case 0x4008:
        this.t.ctrl = (v & 0x80) !== 0; this.t.linReload = v & 0x7f;
        break;
      case 0x400a:
        this.t.period = (this.t.period & 0x700) | v;
        break;
      case 0x400b:
        this.t.period = (this.t.period & 0xff) | ((v & 7) << 8);
        if (this.t.enabled) this.t.len = this.LEN[v >> 3];
        this.t.linFlag = true;
        break;
      case 0x400c:
        this.nz.halt = (v & 0x20) !== 0; this.nz.constVol = (v & 0x10) !== 0; this.nz.vol = v & 0x0f;
        break;
      case 0x400e:
        this.nz.mode = (v >> 7) & 1; this.nz.period = this.NOISE[v & 0x0f];
        break;
      case 0x400f:
        if (this.nz.enabled) this.nz.len = this.LEN[v >> 3];
        this.nz.envStart = true;
        break;
      case 0x4011:
        this.dmc = v & 0x7f;
        break;
      case 0x4015:
        this.p[0].enabled = (v & 1) !== 0; if (!this.p[0].enabled) this.p[0].len = 0;
        this.p[1].enabled = (v & 2) !== 0; if (!this.p[1].enabled) this.p[1].len = 0;
        this.t.enabled = (v & 4) !== 0; if (!this.t.enabled) this.t.len = 0;
        this.nz.enabled = (v & 8) !== 0; if (!this.nz.enabled) this.nz.len = 0;
        break;
      case 0x4017:
        this.seqCycle = 0;
        if (v & 0x80) {
          this.quarter();
          this.half();
        }
        break;
      default:
        break;
    }
  }

  env(c) {
    if (c.envStart) {
      c.envStart = false;
      c.envDecay = 15;
      c.envDiv = c.vol;
    } else if (c.envDiv === 0) {
      c.envDiv = c.vol;
      if (c.envDecay > 0) c.envDecay--;
      else if (c.halt) c.envDecay = 15;
    } else {
      c.envDiv--;
    }
  }

  quarter() {
    this.env(this.p[0]);
    this.env(this.p[1]);
    this.env(this.nz);
    const t = this.t;
    if (t.linFlag) t.lin = t.linReload;
    else if (t.lin > 0) t.lin--;
    if (!t.ctrl) t.linFlag = false;
  }

  sweepTarget(c) {
    const ch = c.period >> c.swShift;
    if (c.swNeg) return c.period - ch - (c.n === 1 ? 1 : 0);
    return c.period + ch;
  }

  half() {
    for (const c of this.p) {
      if (!c.halt && c.len > 0) c.len--;
      const target = this.sweepTarget(c);
      const mute = c.period < 8 || target > 0x7ff;
      if (c.swDiv === 0 && c.swEn && c.swShift > 0 && !mute) c.period = Math.max(0, target);
      if (c.swDiv === 0 || c.swReload) {
        c.swDiv = c.swPeriod;
        c.swReload = false;
      } else {
        c.swDiv--;
      }
    }
    if (!this.t.ctrl && this.t.len > 0) this.t.len--;
    if (!this.nz.halt && this.nz.len > 0) this.nz.len--;
  }

  // advance the 5-step frame sequencer (the game rewrites $4017 every frame)
  stepSequencer(cycles) {
    const before = this.seqCycle;
    const after = before + cycles;
    const ev = (at) => before < at && after >= at;
    if (ev(7457)) this.quarter();
    if (ev(14913)) { this.quarter(); this.half(); }
    if (ev(22371)) this.quarter();
    if (ev(37281)) { this.quarter(); this.half(); }
    this.seqCycle = after >= 37282 ? after - 37282 : after;
  }

  pulseOut(c, cycles) {
    const vol = c.constVol ? c.vol : c.envDecay;
    const target = this.sweepTarget(c);
    const active = c.len > 0 && c.period >= 8 && target <= 0x7ff && vol > 0;
    const duty = this.DUTY[c.duty];
    const per = 2 * (c.period + 1);
    let acc = 0;
    let rem = cycles;
    while (rem > 0) {
      const step = Math.min(rem, c.timer);
      if (active && duty[c.seq]) acc += vol * step;
      c.timer -= step;
      rem -= step;
      if (c.timer <= 0) {
        c.timer += per;
        c.seq = (c.seq + 7) & 7;
      }
    }
    return acc / cycles;
  }

  triOut(cycles) {
    const t = this.t;
    const per = t.period + 1;
    const active = t.len > 0 && t.lin > 0 && t.period >= 2;
    let acc = 0;
    let rem = cycles;
    while (rem > 0) {
      const step = Math.min(rem, t.timer);
      acc += this.TRI[t.seq] * step;
      t.timer -= step;
      rem -= step;
      if (t.timer <= 0) {
        t.timer += per;
        if (active) t.seq = (t.seq + 1) & 31;
      }
    }
    return acc / cycles;
  }

  noiseOut(cycles) {
    const n = this.nz;
    const vol = n.constVol ? n.vol : n.envDecay;
    const active = n.len > 0;
    let acc = 0;
    let rem = cycles;
    while (rem > 0) {
      const step = Math.min(rem, n.timer);
      if (active && !(n.lfsr & 1)) acc += vol * step;
      n.timer -= step;
      rem -= step;
      if (n.timer <= 0) {
        n.timer += n.period;
        const bit = (n.lfsr & 1) ^ ((n.lfsr >> (n.mode ? 6 : 1)) & 1);
        n.lfsr = (n.lfsr >> 1) | (bit << 14);
      }
    }
    return acc / cycles;
  }

  render(out, count) {
    const cps = this.cpuPerSample;
    for (let i = 0; i < count; i++) {
      if (!this.started && this.queue.length >= 2) {
        this.started = true;
        this.nextFrame = this.cycle;
      }
      if (this.started && this.cycle >= this.nextFrame) {
        if (this.queue.length) {
          let n = this.queue.length > 4 ? 2 : 1;
          while (n-- > 0 && this.queue.length) {
            const b = this.queue.shift();
            for (let k = 0; k < b.length; k += 2) this.write(b[k], b[k + 1]);
          }
          this.starved = 0;
          this.nextFrame += this.frameCycles;
        } else {
          this.nextFrame = this.cycle + cps;
          // the game stopped sending frames (tab hidden, paused): go quiet
          if (++this.starved > this.frameCycles / cps * 6) {
            this.write(0x4015, 0);
            this.starved = 0;
            this.started = false;
          }
        }
      }
      this.cycle += cps;
      this.stepSequencer(cps);
      const p1 = this.pulseOut(this.p[0], cps);
      const p2 = this.pulseOut(this.p[1], cps);
      const tr = this.triOut(cps);
      const nz = this.noiseOut(cps);
      const ps = p1 + p2;
      const pulse = ps > 0 ? 95.88 / (8128 / ps + 100) : 0;
      const tndIn = tr / 8227 + nz / 12241 + this.dmc / 22638;
      const tnd = tndIn > 0 ? 159.79 / (1 / tndIn + 100) : 0;
      let s = pulse + tnd;
      // two first-order high-pass filters (~90 Hz and ~440 Hz) and a low-pass, as on the console
      let h = 0.996 * (this.hpPrevOut + s - this.hpPrevIn);
      this.hpPrevIn = s;
      this.hpPrevOut = h;
      let h2 = 0.97 * (this.hpPrevOut2 + h - this.hpPrevIn2);
      this.hpPrevIn2 = h;
      this.hpPrevOut2 = h2;
      this.lp += (h2 - this.lp) * 0.815;
      out[i] = this.muted ? 0 : this.lp * this.volume * 1.6;
    }
    if (this.cycle > 1e12) {
      this.cycle -= 1e12;
      this.nextFrame -= 1e12;
    }
  }
}
