// Audio output. The sound engine (src/game/sound.js) writes APU registers
// through NesAudio.write(); at the end of each game frame the batch of writes
// is handed to the synthesizer (src/core/apu-synth.js), which runs in an
// AudioWorklet when available and in a ScriptProcessor otherwise.
//
// Music: the original compositions are not included. NesAudio.music() receives
// the engine's track changes and plays matching files listed in
// assets/music/tracks.js if the user has supplied any.
'use strict';

const NesAudio = (() => {
  const settings = { volume: 0.8, muted: false };
  try {
    const s = JSON.parse(localStorage.getItem('smb-audio') || '{}');
    if (typeof s.volume === 'number') settings.volume = Math.min(1, Math.max(0, s.volume));
    if (typeof s.muted === 'boolean') settings.muted = s.muted;
  } catch (e) { /* storage unavailable */ }

  let ctx = null;
  let worklet = null; // AudioWorkletNode
  let fallbackApu = null; // NesApu running on the main thread
  let starting = false;
  let batch = [];
  const listeners = [];

  function save() {
    try { localStorage.setItem('smb-audio', JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function notify() {
    for (const f of listeners) f(api);
  }

  function sendSettings() {
    const msg = { volume: settings.volume, muted: settings.muted };
    if (worklet) worklet.port.postMessage(msg);
    if (fallbackApu) {
      fallbackApu.volume = msg.volume;
      fallbackApu.muted = msg.muted;
    }
    musicPlayer.applyVolume();
  }

  function startFallback() {
    fallbackApu = new NesApu(ctx.sampleRate);
    const node = ctx.createScriptProcessor(1024, 0, 1);
    node.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      fallbackApu.render(out, out.length);
    };
    node.connect(ctx.destination);
    sendSettings();
  }

  async function startWorklet() {
    const src = `${NesApu.toString()}
class NesApuProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.apu = new NesApu(sampleRate);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.b) this.apu.push(d.b);
      if (typeof d.volume === 'number') this.apu.volume = d.volume;
      if (typeof d.muted === 'boolean') this.apu.muted = d.muted;
    };
  }
  process(inputs, outputs) {
    const ch = outputs[0];
    this.apu.render(ch[0], ch[0].length);
    for (let c = 1; c < ch.length; c++) ch[c].set(ch[0]);
    return true;
  }
}
registerProcessor('nes-apu', NesApuProcessor);`;
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    worklet = new AudioWorkletNode(ctx, 'nes-apu', { numberOfInputs: 0, outputChannelCount: [1] });
    worklet.connect(ctx.destination);
    sendSettings();
  }

  // Must be called from a user gesture (browsers block audio until then).
  async function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
      return;
    }
    if (starting) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    starting = true;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      ctx = new AC();
    }
    try {
      if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') await startWorklet();
      else startFallback();
    } catch (e) {
      worklet = null;
      startFallback();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    ctx.onstatechange = notify;
    starting = false;
    notify();
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
    musicPlayer.setHidden(document.hidden);
  });

  // ------------------------------------------------------------ music files
  const AREA_TRACKS = {
    0x01: 'overworld', 0x02: 'underwater', 0x04: 'underground', 0x08: 'castle',
    0x10: 'coinHeaven', 0x20: 'pipeIntro', 0x40: 'starman',
  };
  const EVENT_TRACKS = {
    0x01: 'death', 0x02: 'gameOver', 0x04: 'ending', 0x08: 'castleComplete',
    0x10: 'gameOver', 0x20: 'levelComplete', 0x40: 'hurryUp',
  };
  const LOOPING = new Set(['overworld', 'underwater', 'underground', 'castle', 'coinHeaven', 'starman', 'ending']);

  const musicPlayer = (() => {
    const tracks = (typeof MUSIC_TRACKS === 'object' && MUSIC_TRACKS) || {};
    const base = 'assets/music/';
    const cache = {};
    let current = null;
    let paused = false;
    let hidden = false;

    function el(name, fast) {
      const key = fast && tracks[name + 'Fast'] ? name + 'Fast' : name;
      const file = tracks[key];
      if (!file) return null;
      if (!cache[key]) {
        const a = new window.Audio(base + file);
        a.preload = 'auto';
        a.loop = LOOPING.has(name);
        cache[key] = a;
      }
      const a = cache[key];
      // no dedicated fast version: speed the normal one up
      a.playbackRate = fast && key === name ? 1.3 : 1;
      return a;
    }

    function stop() {
      if (current) {
        current.pause();
        current = null;
      }
    }

    function applyVolume() {
      for (const k in cache) cache[k].volume = settings.muted ? 0 : settings.volume * 0.6;
    }

    function play(area, eventBit, fast) {
      stop();
      const name = eventBit ? EVENT_TRACKS[eventBit] : AREA_TRACKS[area];
      if (!name) return;
      const a = el(name, fast);
      if (!a) return;
      applyVolume();
      a.currentTime = 0;
      current = a;
      if (!paused && !hidden) a.play().catch(() => {});
    }

    function setPaused(p) {
      if (p === paused) return;
      paused = p;
      if (!current) return;
      if (p || hidden) current.pause();
      else current.play().catch(() => {});
    }

    function setHidden(h) {
      hidden = h;
      if (!current) return;
      if (h || paused) current.pause();
      else current.play().catch(() => {});
    }

    return { play, stop, setPaused, setHidden, applyVolume, count: Object.keys(tracks).length };
  })();

  const api = {
    get ready() { return !!ctx && ctx.state === 'running'; },
    get started() { return !!ctx; },
    get volume() { return settings.volume; },
    get muted() { return settings.muted; },
    get musicFiles() { return musicPlayer.count; },
    unlock,
    write(reg, v) {
      batch.push(reg, v);
    },
    // called once per game frame, after the sound engine ran
    endFrame(pauseMode) {
      musicPlayer.setPaused(!!pauseMode);
      if (worklet) worklet.port.postMessage({ b: batch });
      else if (fallbackApu) fallbackApu.push(batch);
      batch = [];
    },
    music(area, eventBit, fast) {
      musicPlayer.play(area, eventBit, fast);
    },
    reset() {
      batch = [];
      musicPlayer.stop();
    },
    setVolume(v) {
      settings.volume = Math.min(1, Math.max(0, v));
      if (settings.volume > 0) settings.muted = false;
      save();
      sendSettings();
      notify();
    },
    setMuted(m) {
      settings.muted = !!m;
      save();
      sendSettings();
      notify();
    },
    toggleMute() {
      api.setMuted(!settings.muted);
    },
    onChange(f) {
      listeners.push(f);
    },
  };
  return api;
})();
