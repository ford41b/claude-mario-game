// Boot, fixed-timestep frame loop, video output and the page controls.
'use strict';

(() => {
  const FRAME_HZ = 60.0988; // NTSC NES frame rate
  const FRAME_MS = 1000 / FRAME_HZ;
  const PAR_8_7 = 8 / 7; // NES pixel aspect ratio on a 4:3 television

  const canvas = document.getElementById('screen');
  const viewport = document.getElementById('viewport');
  const gctx = canvas.getContext('2d', { alpha: false });

  // native 256x240 frame
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = SCREEN_W;
  frameCanvas.height = SCREEN_H;
  const fctx = frameCanvas.getContext('2d', { alpha: false });
  const image = fctx.createImageData(SCREEN_W, SCREEN_H);
  const pixels = new Uint32Array(image.data.buffer);
  // integer pre-scale buffer used for crisp non-integer scaling
  const scaleCanvas = document.createElement('canvas');
  const sctx = scaleCanvas.getContext('2d', { alpha: false });

  const prefs = { par: false, crop: false };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('smb-video') || '{}')); } catch (e) { /* ignore */ }
  function savePrefs() {
    try { localStorage.setItem('smb-video', JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  let paused = false; // emulation halted (separate from the game's own pause)
  let frameCount = 0;

  // ------------------------------------------------------------------ game
  function boot() {
    Art.finish();
    UserRom.restore();
    NesAudio.reset();
    PowerOn();
  }

  function runFrame() {
    const [p1, p2] = Input.poll();
    Joypad.p1 = p1;
    Joypad.p2 = p2;
    NonMaskableInterrupt();
    NesAudio.endFrame(ram[PauseModeFlag] !== 0 || (ram[GamePauseStatus] & 1) !== 0);
    frameCount++;
  }

  // the NES reset button: back to the title screen, top score kept
  function resetConsole() {
    NesAudio.reset();
    WarmBoot();
    paused = false;
    updateUi();
  }

  // ------------------------------------------------------------------ video
  let destW = 0, destH = 0;

  function layout() {
    const fs = document.fullscreenElement === viewport;
    const dpr = window.devicePixelRatio || 1;
    const srcH = prefs.crop ? 224 : 240;
    const aspectW = SCREEN_W * (prefs.par ? PAR_8_7 : 1);
    let availW, availH;
    if (fs) {
      availW = window.innerWidth;
      availH = window.innerHeight;
    } else {
      // side-by-side layout above 900px (controls panel 250px + gap), stacked below
      const wide = window.innerWidth > 900;
      availW = Math.max(160, window.innerWidth - 32 - (wide ? 274 : 0));
      availH = Math.max(150, window.innerHeight - (wide ? 110 : 140));
    }
    // largest size that fits; in the page prefer whole multiples of the
    // source height (exact pixels) unless that wastes too much space
    let scale = Math.min(availW / aspectW, availH / srcH);
    if (!fs && scale * dpr >= 1) {
      const whole = Math.floor(scale * dpr) / dpr;
      if (whole / scale >= 0.75) scale = whole;
    }
    const cssW = Math.round(aspectW * scale);
    const cssH = Math.round(srcH * scale);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    destW = Math.round(cssW * dpr);
    destH = Math.round(cssH * dpr);
    if (canvas.width !== destW || canvas.height !== destH) {
      canvas.width = destW;
      canvas.height = destH;
    }
    // pre-scale by the smallest integer factor that reaches the target size
    const k = Math.max(1, Math.ceil(Math.max(destW / SCREEN_W, destH / srcH)));
    if (scaleCanvas.width !== SCREEN_W * k || scaleCanvas.height !== SCREEN_H * k) {
      scaleCanvas.width = SCREEN_W * k;
      scaleCanvas.height = SCREEN_H * k;
    }
    present();
  }

  function present() {
    ppuRender(pixels);
    fctx.putImageData(image, 0, 0);
    const top = prefs.crop ? 8 : 0;
    const srcH = prefs.crop ? 224 : 240;
    const exact = destW % SCREEN_W === 0 && destH % srcH === 0 && destW / SCREEN_W === destH / srcH;
    if (exact) {
      gctx.imageSmoothingEnabled = false;
      gctx.drawImage(frameCanvas, 0, top, SCREEN_W, srcH, 0, 0, destW, destH);
    } else {
      // nearest-neighbour to an integer multiple, then a light filtered
      // downscale: keeps pixels sharp without uneven widths
      const k = scaleCanvas.width / SCREEN_W;
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(frameCanvas, 0, 0, SCREEN_W * k, SCREEN_H * k);
      gctx.imageSmoothingEnabled = true;
      gctx.imageSmoothingQuality = 'medium';
      gctx.drawImage(scaleCanvas, 0, top * k, SCREEN_W * k, srcH * k, 0, 0, destW, destH);
    }
  }

  // ------------------------------------------------------------------ loop
  let last = 0;
  let acc = 0;

  function tick(now) {
    requestAnimationFrame(tick);
    if (!last) last = now;
    let dt = now - last;
    last = now;
    if (dt > 250) dt = FRAME_MS; // tab was in the background: don't fast-forward
    // displays near 60 Hz: lock to one game frame per refresh so motion is
    // perfectly even (the 0.16% speed difference is not noticeable)
    if (Math.abs(dt - FRAME_MS) < 0.6) dt = FRAME_MS;
    if (paused) {
      acc = 0;
      return;
    }
    acc += dt;
    let ran = 0;
    while (acc >= FRAME_MS - 0.5 && ran < 4) {
      runFrame();
      acc -= FRAME_MS;
      ran++;
    }
    if (acc > FRAME_MS * 2) acc = 0;
    if (acc < -FRAME_MS) acc = 0;
    if (ran) present();
  }

  // ------------------------------------------------------------------ UI
  const $ = (id) => document.getElementById(id);
  const btnPause = $('btn-pause');
  const btnReset = $('btn-reset');
  const btnMute = $('btn-mute');
  const volume = $('volume');
  const btnFull = $('btn-fullscreen');
  const btnAspect = $('btn-aspect');
  const btnCrop = $('btn-crop');
  const audioNote = $('audio-note');
  const pauseBadge = $('paused-badge');
  const padNote = $('pad-note');

  function updateUi() {
    btnPause.textContent = paused ? 'Resume' : 'Freeze';
    btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pauseBadge.hidden = !paused;
    btnMute.textContent = NesAudio.muted ? 'Unmute' : 'Mute';
    btnMute.setAttribute('aria-pressed', NesAudio.muted ? 'true' : 'false');
    volume.value = String(Math.round(NesAudio.volume * 100));
    btnAspect.textContent = prefs.par ? 'Pixels: 8:7 (TV)' : 'Pixels: square';
    btnCrop.textContent = prefs.crop ? 'Overscan: hidden' : 'Overscan: shown';
    if (!NesAudio.started) audioNote.textContent = 'Click or press a key to enable sound.';
    else if (!NesAudio.ready) audioNote.textContent = 'Sound is suspended.';
    else if (RomMusic.enabled || NesAudio.musicFiles) audioNote.textContent = '';
    else audioNote.textContent = 'Sound effects on. Music not included (see README).';
  }

  function setPaused(p) {
    paused = p;
    if (paused) Input.clear();
    updateUi();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (viewport.requestFullscreen) viewport.requestFullscreen().catch(() => {});
  }

  btnPause.addEventListener('click', () => setPaused(!paused));
  btnReset.addEventListener('click', () => resetConsole());
  btnMute.addEventListener('click', () => { NesAudio.unlock(); NesAudio.toggleMute(); });
  volume.addEventListener('input', () => { NesAudio.unlock(); NesAudio.setVolume(Number(volume.value) / 100); });
  btnFull.addEventListener('click', toggleFullscreen);
  btnAspect.addEventListener('click', () => { prefs.par = !prefs.par; savePrefs(); layout(); updateUi(); });
  btnCrop.addEventListener('click', () => { prefs.crop = !prefs.crop; savePrefs(); layout(); updateUi(); });
  // keep buttons from stealing the keyboard (Space/Enter would click them)
  for (const b of document.querySelectorAll('button')) b.addEventListener('mouseup', () => b.blur());

  // emulator hotkeys (not NES buttons)
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.code) {
      case 'KeyF': toggleFullscreen(); break;
      case 'KeyM': NesAudio.toggleMute(); break;
      case 'KeyP': case 'Pause': setPaused(!paused); break;
      case 'Escape': if (paused && !document.fullscreenElement) setPaused(false); return;
      case 'F2': resetConsole(); break;
      default: return;
    }
    e.preventDefault();
  });

  // audio may only start after a user gesture
  const unlock = () => NesAudio.unlock();
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('touchend', unlock);
  NesAudio.onChange(updateUi);

  // pause the game (with the game's own pause) when the window loses focus
  window.addEventListener('blur', () => {
    if (ram[OperMode] === GameModeValue && ram[OperMode_Task] === 3 && ram[GamePauseStatus] === 0 &&
        ram[GamePauseTimer] === 0) {
      Input.pressForOneFrame(Input.START);
    }
  });

  window.addEventListener('gamepadconnected', () => {
    padNote.textContent = 'Gamepad connected.';
  });
  window.addEventListener('gamepaddisconnected', () => {
    padNote.textContent = '';
  });

  // optional ROM file for the original graphics and music
  const romFile = $('rom-file');
  const romStatus = $('rom-status');
  function updateRomUi(msg) {
    const on = UserRom.loaded;
    $('btn-rom-forget').hidden = !on;
    $('rom-gfx-row').hidden = !on;
    $('rom-music-row').hidden = !on;
    $('rom-gfx').checked = UserRom.graphics;
    $('rom-music').checked = UserRom.music;
    $('btn-rom').textContent = on ? 'Replace ROM\u2026' : 'Load ROM file\u2026';
    romStatus.textContent = msg || (on ? 'Using your ROM.' : '');
  }
  $('btn-rom').addEventListener('click', () => romFile.click());
  romFile.addEventListener('change', async () => {
    const f = romFile.files && romFile.files[0];
    romFile.value = '';
    if (!f) return;
    const err = await UserRom.loadFile(f);
    if (!err) resetConsole();
    updateRomUi(err || 'ROM loaded: original graphics and music enabled.');
  });
  $('btn-rom-forget').addEventListener('click', () => { UserRom.forget(); resetConsole(); updateRomUi('ROM removed from this browser.'); });
  $('rom-gfx').addEventListener('change', (e) => { UserRom.setGraphics(e.target.checked); resetConsole(); updateRomUi(); });
  $('rom-music').addEventListener('change', (e) => { UserRom.setMusic(e.target.checked); resetConsole(); updateRomUi(); });

  window.addEventListener('resize', layout);
  document.addEventListener('fullscreenchange', layout);

  // debugging/test hook
  window.SMB = {
    ram, PPU, runFrame, present, resetConsole,
    get frameCount() { return frameCount; },
    setPaused,
  };

  boot();
  layout();
  updateUi();
  updateRomUi();
  requestAnimationFrame(tick);
})();
