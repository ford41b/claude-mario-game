// Keyboard and gamepad input, mapped onto NES controller bits
// (A B Select Start Up Down Left Right = $80 $40 $20 $10 $08 $04 $02 $01).
'use strict';

const Input = (() => {
  const A = 0x80, B = 0x40, SELECT = 0x20, START = 0x10, UP = 0x08, DOWN = 0x04, LEFT = 0x02, RIGHT = 0x01;

  const KEYMAP = {
    ArrowRight: RIGHT, KeyD: RIGHT,
    ArrowLeft: LEFT, KeyA: LEFT,
    ArrowUp: UP, KeyW: UP,
    ArrowDown: DOWN, KeyS: DOWN,
    KeyX: A, KeyK: A, Space: A,
    KeyZ: B, KeyJ: B,
    Enter: START, NumpadEnter: START,
    ShiftRight: SELECT, Tab: SELECT,
  };

  const held = new Map(); // code -> press order
  let order = 0;
  let enabled = true;
  let pulse = 0; // bits forced on for one frame (e.g. auto-pause)

  function onKeyDown(e) {
    if (!enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const bit = KEYMAP[e.code];
    if (bit === undefined) return;
    e.preventDefault();
    if (!held.has(e.code)) held.set(e.code, ++order);
  }
  function onKeyUp(e) {
    if (KEYMAP[e.code] === undefined) return;
    e.preventDefault();
    held.delete(e.code);
  }
  function clear() {
    held.clear();
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clear);

  // A real D-pad cannot press opposite directions at once; resolve to the
  // most recently pressed one.
  function keyboardBits() {
    let bits = 0;
    const last = {};
    for (const [code, n] of held) {
      const bit = KEYMAP[code];
      bits |= bit;
      if (!(bit in last) || n > last[bit]) last[bit] = n;
    }
    if ((bits & (LEFT | RIGHT)) === (LEFT | RIGHT)) bits &= ~(last[LEFT] > last[RIGHT] ? RIGHT : LEFT);
    if ((bits & (UP | DOWN)) === (UP | DOWN)) bits &= ~(last[UP] > last[DOWN] ? DOWN : UP);
    return bits;
  }

  // standard gamepad mapping
  function padBits(gp) {
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    let bits = 0;
    if (b(0) || b(1)) bits |= A; // bottom / right face buttons
    if (b(2) || b(3)) bits |= B; // left / top face buttons
    if (b(8)) bits |= SELECT;
    if (b(9)) bits |= START;
    if (b(12)) bits |= UP;
    if (b(13)) bits |= DOWN;
    if (b(14)) bits |= LEFT;
    if (b(15)) bits |= RIGHT;
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    if (ax < -0.5) bits |= LEFT;
    if (ax > 0.5) bits |= RIGHT;
    if (ay < -0.5) bits |= UP;
    if (ay > 0.5) bits |= DOWN;
    if ((bits & (LEFT | RIGHT)) === (LEFT | RIGHT)) bits &= ~(LEFT | RIGHT);
    if ((bits & (UP | DOWN)) === (UP | DOWN)) bits &= ~(UP | DOWN);
    return bits;
  }

  let padNames = [];

  function gamepads() {
    if (!navigator.getGamepads) return [];
    const list = [];
    for (const gp of navigator.getGamepads()) if (gp && gp.connected) list.push(gp);
    return list;
  }

  // Returns [controller1, controller2]. The keyboard drives both controllers
  // (Luigi uses controller 2 in a two player game); with two or more gamepads
  // connected, the first pad is controller 1 and the second is controller 2.
  function poll() {
    if (!enabled) return [0, 0];
    const kb = keyboardBits();
    const pads = gamepads();
    padNames = pads.map((p) => p.id);
    let p1 = kb, p2 = kb;
    if (pads.length === 1) {
      const v = padBits(pads[0]);
      p1 |= v;
      p2 |= v;
    } else if (pads.length >= 2) {
      p1 |= padBits(pads[0]);
      p2 |= padBits(pads[1]);
    }
    p1 |= pulse;
    pulse = 0;
    return [p1, p2];
  }

  // any button on any pad is pressed (used to start audio, close overlays)
  function anyPadButton() {
    for (const gp of gamepads()) for (const btn of gp.buttons) if (btn.pressed) return true;
    return false;
  }

  return {
    poll,
    clear,
    anyPadButton,
    pressForOneFrame(bits) { pulse |= bits; },
    setEnabled(v) { enabled = v; if (!v) clear(); },
    get padNames() { return padNames; },
    START,
  };
})();
