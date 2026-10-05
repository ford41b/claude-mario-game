// Sprite drawing routines (writing the OAM buffer at $0200), relative
// positions and offscreen bits. Port of DrawVine .. DrawSpriteObject.
'use strict';

function DumpSixSpr(a, y) {
  ram[Sprite_Data + ((20 + y) & 0xff)] = a;
  ram[Sprite_Data + ((16 + y) & 0xff)] = a;
  DumpFourSpr(a, y);
}
function DumpFourSpr(a, y) {
  ram[Sprite_Data + ((12 + y) & 0xff)] = a;
  DumpThreeSpr(a, y);
}
function DumpThreeSpr(a, y) {
  ram[Sprite_Data + ((8 + y) & 0xff)] = a;
  DumpTwoSpr(a, y);
}
function DumpTwoSpr(a, y) {
  ram[Sprite_Data + ((4 + y) & 0xff)] = a;
  ram[Sprite_Data + (y & 0xff)] = a;
}
function MoveSixSpritesOffscreen(y) {
  DumpSixSpr(0xf8, y);
}

// OAM field accessors (y = OAM byte offset of a sprite)
const sprY = (y) => Sprite_Y_Position + (y & 0xff);
const sprT = (y) => Sprite_Tilenumber + (y & 0xff);
const sprA = (y) => Sprite_Attributes + (y & 0xff);
const sprX = (y) => Sprite_X_Position + (y & 0xff);

function DrawVine(y) {
  ram[0x00] = y;
  const a = add(ram[Enemy_Rel_YPos], ROM[L.VineYPosAdder + y]);
  const x = ram[VineObjOffset + y];
  let o = ram[Enemy_SprDataOffset + x];
  ram[0x02] = o;
  SixSpriteStacker(a, o);
  o = ram[0x02];
  const rx = ram[Enemy_Rel_XPos];
  ram[sprX(o)] = rx;
  ram[sprX(o + 8)] = rx;
  ram[sprX(o + 16)] = rx;
  const rx6 = add(rx, 0x06);
  ram[sprX(o + 4)] = rx6;
  ram[sprX(o + 12)] = rx6;
  ram[sprX(o + 20)] = rx6;
  ram[sprA(o)] = 0x21;
  ram[sprA(o + 8)] = 0x21;
  ram[sprA(o + 16)] = 0x21;
  ram[sprA(o + 4)] = 0x61;
  ram[sprA(o + 12)] = 0x61;
  ram[sprA(o + 20)] = 0x61;
  for (let n = 0; n < 6; n++) ram[sprT(o + n * 4)] = 0xe1;
  if (ram[0x00] === 0) ram[sprT(o)] = 0xe0;
  for (let n = 0; n < 6; n++) {
    if (sub(ram[VineStart_Y_Position], ram[sprY(o)]) >= 0x64) ram[sprY(o)] = 0xf8;
    o += 4;
  }
  return ram[0x00];
}

function SixSpriteStacker(a, y) {
  for (let n = 0; n < 6; n++) {
    ram[Sprite_Data + (y & 0xff)] = a;
    a = add(a, 0x08);
    y += 4;
  }
  return ram[0x02];
}

function DrawHammer(x) {
  const y = ram[Misc_SprDataOffset + x];
  let p = 0;
  if (!ram[TimerControl] && (ram[Misc_State + x] & 0x7f) === 0x01) p = (ram[FrameCounter] >> 2) & 0x03;
  const yy = add(ram[Misc_Rel_YPos], ROM[L.FirstSprYPos + p]);
  ram[sprY(y)] = yy;
  ram[sprY(y + 4)] = add(yy, ROM[L.SecondSprYPos + p]);
  const xx = add(ram[Misc_Rel_XPos], ROM[L.FirstSprXPos + p]);
  ram[sprX(y)] = xx;
  ram[sprX(y + 4)] = add(xx, ROM[L.SecondSprXPos + p]);
  ram[sprT(y)] = ROM[L.FirstSprTilenum + p];
  ram[sprT(y + 4)] = ROM[L.SecondSprTilenum + p];
  ram[sprA(y)] = ROM[L.HammerSprAttrib + p];
  ram[sprA(y + 4)] = ROM[L.HammerSprAttrib + p];
  if (ram[Misc_OffscreenBits] & 0xfc) {
    ram[Misc_State + x] = 0;
    DumpTwoSpr(0xf8, y);
  }
}

function FlagpoleGfxHandler(x) {
  let y = ram[Enemy_SprDataOffset + x];
  const rx = ram[Enemy_Rel_XPos];
  ram[sprX(y)] = rx;
  const rx8 = add(rx, 0x08);
  ram[sprX(y + 4)] = rx8;
  ram[sprX(y + 8)] = rx8;
  ram[0x05] = add(rx8, 0x0c);
  const ey = ram[Enemy_Y_Position + x];
  DumpTwoSpr(ey, y);
  ram[sprY(y + 8)] = adc(ey, 0x08);
  ram[0x02] = ram[FlagpoleFNum_Y_Pos];
  ram[0x03] = 0x01;
  ram[0x04] = 0x01;
  ram[sprA(y)] = 0x01;
  ram[sprA(y + 4)] = 0x01;
  ram[sprA(y + 8)] = 0x01;
  ram[sprT(y)] = 0x7e;
  ram[sprT(y + 8)] = 0x7e;
  ram[sprT(y + 4)] = 0x7f;
  if (ram[FlagpoleCollisionYPos]) {
    y = (y + 0x0c) & 0xff;
    const s = ram[FlagpoleScore] * 2;
    ram[0x00] = ROM[L.FlagpoleScoreNumTiles + s];
    ram[0x01] = ROM[L.FlagpoleScoreNumTiles + s + 1];
    DrawSpriteObject(y);
  }
  // ChkFlagOffscreen
  x = ram[ObjectOffset];
  y = ram[Enemy_SprDataOffset + x];
  if (ram[Enemy_OffscreenBits] & 0x0e) MoveSixSpritesOffscreen(y);
}

function DrawLargePlatform(x) {
  let y = ram[Enemy_SprDataOffset + x];
  ram[0x02] = y;
  SixSpriteStacker(ram[Enemy_Rel_XPos], y + 3);
  y = ram[0x02];
  DumpFourSpr(ram[Enemy_Y_Position + x], y);
  let a = ram[Enemy_Y_Position + x];
  if (ram[AreaType] === 0x03 || ram[SecondaryHardMode]) a = 0xf8;
  y = ram[Enemy_SprDataOffset + x];
  ram[sprY(y + 16)] = a;
  ram[sprY(y + 20)] = a;
  const tile = ram[CloudTypeOverride] ? 0x75 : 0x5b;
  DumpSixSpr(tile, y + 1);
  DumpSixSpr(0x02, y + 2);
  const bits = GetXOffscreenBits(x + 1);
  y = ram[Enemy_SprDataOffset + x];
  if (bits & 0x80) ram[sprY(y)] = 0xf8;
  if (bits & 0x40) ram[sprY(y + 4)] = 0xf8;
  if (bits & 0x20) ram[sprY(y + 8)] = 0xf8;
  if (bits & 0x10) ram[sprY(y + 12)] = 0xf8;
  if (bits & 0x08) ram[sprY(y + 16)] = 0xf8;
  if (bits & 0x04) ram[sprY(y + 20)] = 0xf8;
  if (ram[Enemy_OffscreenBits] & 0x80) MoveSixSpritesOffscreen(y);
}

function DrawFloateyNumber_Coin(x, y) {
  if (!(ram[FrameCounter] & 1)) ram[Misc_Y_Position + x] = (ram[Misc_Y_Position + x] - 1) & 0xff;
  DumpTwoSpr(ram[Misc_Y_Position + x], y);
  ram[sprX(y)] = ram[Misc_Rel_XPos];
  ram[sprX(y + 4)] = add(ram[Misc_Rel_XPos], 0x08);
  ram[sprA(y)] = 0x02;
  ram[sprA(y + 4)] = 0x02;
  ram[sprT(y)] = 0xf7;
  ram[sprT(y + 4)] = 0xfb;
}

function JCoinGfxHandler(x) {
  const y = ram[Misc_SprDataOffset + x];
  if (ram[Misc_State + x] >= 0x02) {
    DrawFloateyNumber_Coin(x, y);
    return;
  }
  ram[sprY(y)] = ram[Misc_Y_Position + x];
  ram[sprY(y + 4)] = add(ram[Misc_Y_Position + x], 0x08);
  ram[sprX(y)] = ram[Misc_Rel_XPos];
  ram[sprX(y + 4)] = ram[Misc_Rel_XPos];
  const t = ROM[L.JumpingCoinTiles + ((ram[FrameCounter] >> 1) & 0x03)];
  DumpTwoSpr(t, y + 1);
  ram[sprA(y)] = 0x02;
  ram[sprA(y + 4)] = 0x82;
}

function DrawPowerUp() {
  let y = ram[Enemy_SprDataOffset + 5];
  ram[0x02] = add(ram[Enemy_Rel_YPos], 0x08);
  ram[0x05] = ram[Enemy_Rel_XPos];
  const t = ram[PowerUpType];
  ram[0x04] = ROM[L.PowerUpAttributes + t] | ram[Enemy_SprAttrib + 5];
  let x = t * 4;
  ram[0x07] = 0x01;
  ram[0x03] = 0x01;
  for (let r = 0; r < 2; r++) {
    ram[0x00] = ROM[L.PowerUpGfxTable + x];
    ram[0x01] = ROM[L.PowerUpGfxTable + x + 1];
    y = DrawSpriteObject(y);
    x += 2;
  }
  y = ram[Enemy_SprDataOffset + 5];
  if (t !== 0 && t !== 0x03) {
    ram[0x00] = t;
    const a = ((ram[FrameCounter] >> 1) & 0x03) | ram[Enemy_SprAttrib + 5];
    ram[sprA(y)] = a;
    ram[sprA(y + 4)] = a;
    if (t !== 1) {
      ram[sprA(y + 8)] = a;
      ram[sprA(y + 12)] = a;
    }
    ram[sprA(y + 4)] |= 0x40;
    ram[sprA(y + 12)] |= 0x40;
  }
  SprObjectOffscrChk(ram[ObjectOffset]);
}

// -------------------------------------------------------------------------------------

function EnemyGfxHandler(x) {
  ram[0x02] = ram[Enemy_Y_Position + x];
  ram[0x05] = ram[Enemy_Rel_XPos];
  ram[0xeb] = ram[Enemy_SprDataOffset + x];
  ram[VerticalFlipFlag] = 0;
  ram[0x03] = ram[Enemy_MovingDir + x];
  ram[0x04] = ram[Enemy_SprAttrib + x];
  let a = ram[Enemy_ID + x];
  if (a === PiranhaPlant) {
    if (!neg(ram[PiranhaPlant_Y_Speed + x]) && ram[EnemyFrameTimer + x] !== 0) return;
  }
  // CheckForRetainerObj
  ram[0xed] = ram[Enemy_State + x];
  let y = ram[0xed] & 0x1f;
  a = ram[Enemy_ID + x];
  if (a === RetainerObject) {
    y = 0;
    ram[0x03] = 0x01;
    a = 0x15;
  }
  if (a === BulletBill_CannonVar) {
    ram[0x02] = (ram[0x02] - 1) & 0xff;
    let at = 0x03;
    if (ram[EnemyFrameTimer + x]) at |= 0x20;
    ram[0x04] = at;
    y = 0;
    ram[0xed] = 0;
    a = 0x08;
  }
  if (a === JumpspringObject) {
    y = 0x03;
    a = ROM[L.JumpspringFrameOffsets + ram[JumpspringAnimCtrl]];
  }
  // CheckForPodoboo
  ram[0xef] = a;
  ram[0xec] = y;
  x = ram[ObjectOffset];
  if (a === 0x0c && !neg(ram[Enemy_Y_Speed + x])) ram[VerticalFlipFlag]++;
  // CheckBowserGfxFlag
  if (ram[BowserGfxFlag]) ram[0xef] = ram[BowserGfxFlag] === 1 ? 0x16 : 0x17;
  // CheckForGoomba
  y = ram[0xef];
  if (y === Goomba) {
    const st = ram[Enemy_State + x];
    if (st >= 0x02) ram[0xec] = 0x04;
    if (!((st & 0x20) | ram[TimerControl]) && !(ram[FrameCounter] & 0x08)) ram[0x03] ^= 0x03;
  }
  // CheckBowserFront
  ram[0x04] |= ROM[L.EnemyAttributeData + y];
  let gx = ROM[L.EnemyGfxTableOffsets + y];
  y = ram[0xec];
  let skipToDraw = false;
  if (ram[BowserGfxFlag]) {
    if (ram[BowserGfxFlag] === 1) {
      if (neg(ram[BowserBodyControls])) gx = 0xde;
      if (ram[0xed] & 0x20) ram[VerticalFlipFlag] = gx;
    } else {
      if (ram[BowserBodyControls] & 0x01) gx = 0xe4;
      if (ram[0xed] & 0x20) {
        ram[0x02] = sub(ram[0x02], 0x10);
        ram[VerticalFlipFlag] = gx;
      }
    }
    skipToDraw = true;
  }
  if (!skipToDraw) {
    let step = 'spiny';
    if (gx === 0x24) {
      // CheckForSpiny
      if (y === 0x05) {
        gx = 0x30;
        ram[0x03] = 0x02;
        ram[0xec] = 0x05;
      }
      step = 'hammerbro';
    } else if (gx === 0x90) {
      // CheckForLakitu
      if (!(ram[0xed] & 0x20) && ram[FrenzyEnemyTimer] < 0x10) gx = 0x96;
      step = 'defeated';
    } else {
      // CheckUpsideDownShell
      if (ram[0xef] < 0x04 && y >= 0x02) {
        gx = 0x5a;
        if (ram[0xef] === BuzzyBeetle) {
          gx = 0x7e;
          ram[0x02]++;
        }
      }
      // CheckRightSideUpShell
      if (ram[0xec] === 0x04) {
        gx = 0x72;
        ram[0x02]++;
        if (ram[0xef] !== BuzzyBeetle) {
          gx = 0x66;
          ram[0x02]++;
          if (ram[0xef] === Goomba) {
            gx = 0x54;
            if (!(ram[0xed] & 0x20)) {
              gx = 0x8a;
              ram[0x02]--;
            }
          }
        }
      }
      step = 'hammerbro';
    }
    if (step === 'hammerbro') {
      // CheckForHammerBro
      const oy = ram[ObjectOffset];
      if (ram[0xef] === HammerBro) {
        if (ram[0xed] === 0) step = 'animate';
        else if (!(ram[0xed] & 0x08)) step = 'defeated';
        else {
          gx = 0xb4;
          step = 'animate';
        }
      } else if (gx === 0x48) {
        step = 'animate';
      } else {
        const t = ram[EnemyIntervalTimer + oy];
        if (t >= 0x05) step = 'defeated';
        else if (gx !== 0x3c) step = 'animate';
        else if (t === 0x01) step = 'defeated';
        else {
          ram[0x02] = (ram[0x02] + 3) & 0xff;
          step = 'animstop';
        }
      }
    }
    if (step === 'animate') {
      // CheckToAnimateEnemy
      const e = ram[0xef];
      if (e === Goomba || e === 0x08 || e === Podoboo || e >= 0x18) {
        step = 'defeated';
      } else if (e === 0x15) {
        if (ram[WorldNumber] < World8) {
          gx = 0xa2;
          ram[0xec] = 0x03;
        }
        step = 'defeated';
      } else if (ram[FrameCounter] & ROM[L.EnemyAnimTimingBMask + 0]) {
        step = 'defeated';
      } else {
        step = 'animstop';
      }
    }
    if (step === 'animstop') {
      // CheckAnimationStop
      if (!((ram[0xed] & 0xa0) | ram[TimerControl])) gx = (gx + 6) & 0xff;
      step = 'defeated';
    }
    // CheckDefeatedState
    if ((ram[0xed] & 0x20) && ram[0xef] >= 0x04) {
      ram[VerticalFlipFlag] = 0x01;
      ram[0xec] = 0x00;
    }
  }
  // DrawEnemyObject
  let o = ram[0xeb];
  for (let r = 0; r < 3; r++) {
    ram[0x00] = ROM[L.EnemyGraphicsTable + gx];
    ram[0x01] = ROM[L.EnemyGraphicsTable + gx + 1];
    o = DrawSpriteObject(o);
    gx = (gx + 2) & 0xff;
  }
  x = ram[ObjectOffset];
  y = ram[Enemy_SprDataOffset + x];
  if (ram[0xef] === 0x08) {
    SprObjectOffscrChk(x);
    return;
  }
  // CheckForVerticalFlip
  if (ram[VerticalFlipFlag]) {
    DumpSixSpr(ram[sprA(y)] | 0x80, y + 2);
    let fx = y;
    const e = ram[0xef];
    if (e !== HammerBro && e !== Lakitu && e < 0x15) fx = (fx + 8) & 0xff;
    const t0 = ram[sprT(fx)];
    const t1 = ram[sprT(fx + 4)];
    ram[sprT(fx)] = ram[sprT(y + 16)];
    ram[sprT(fx + 4)] = ram[sprT(y + 20)];
    ram[sprT(y + 20)] = t1;
    ram[sprT(y + 16)] = t0;
  }
  // CheckForESymmetry
  if (ram[BowserGfxFlag]) {
    SprObjectOffscrChk(x);
    return;
  }
  const e = ram[0xef];
  const alt = ram[0xec];
  if (e === 0x05) {
    SprObjectOffscrChk(x);
    return;
  }
  let mirror = false;
  if (e === Bloober || e === PiranhaPlant || e === Podoboo) mirror = true;
  else if (e === Spiny && alt !== 0x05) mirror = false;
  else {
    if (e === 0x15) ram[sprA(y + 20)] = 0x42;
    mirror = alt >= 0x02;
  }
  if (mirror && !ram[BowserGfxFlag]) {
    let at = ram[sprA(y)] & 0xa3;
    ram[sprA(y)] = at;
    ram[sprA(y + 8)] = at;
    ram[sprA(y + 16)] = at;
    at |= 0x40;
    if (alt === 0x05) at |= 0x80;
    ram[sprA(y + 4)] = at;
    ram[sprA(y + 12)] = at;
    ram[sprA(y + 20)] = at;
    if (alt === 0x04) {
      let b = ram[sprA(y + 8)] | 0x80;
      ram[sprA(y + 8)] = b;
      ram[sprA(y + 16)] = b;
      b |= 0x40;
      ram[sprA(y + 12)] = b;
      ram[sprA(y + 20)] = b;
    }
  }
  // CheckToMirrorLakitu
  if (e === Lakitu) {
    if (!ram[VerticalFlipFlag]) {
      ram[sprA(y + 16)] &= 0x81;
      const b = ram[sprA(y + 20)] | 0x41;
      ram[sprA(y + 20)] = b;
      if (ram[FrenzyEnemyTimer] < 0x10) {
        ram[sprA(y + 12)] = b;
        ram[sprA(y + 8)] = b & 0x81;
      }
      SprObjectOffscrChk(x);
      return;
    }
    ram[sprA(y)] &= 0x81;
    ram[sprA(y + 4)] |= 0x41;
  }
  // CheckToMirrorJSpring
  if (e >= 0x18) {
    ram[sprA(y + 8)] = 0x82;
    ram[sprA(y + 16)] = 0x82;
    ram[sprA(y + 12)] = 0xc2;
    ram[sprA(y + 20)] = 0xc2;
  }
  SprObjectOffscrChk(x);
}

function SprObjectOffscrChk(x) {
  x = ram[ObjectOffset];
  const bits = ram[Enemy_OffscreenBits];
  if (bits & 0x04) MoveESprColOffscreen(x, 0x04);
  if (bits & 0x08) MoveESprColOffscreen(x, 0x00);
  if (bits & 0x20) MoveESprRowOffscreen(x, 0x10);
  if (bits & 0x40) MoveESprRowOffscreen(x, 0x08);
  if (bits & 0x80) {
    MoveESprRowOffscreen(x, 0x00);
    if (ram[Enemy_ID + x] !== Podoboo && ram[Enemy_Y_HighPos + x] === 0x02) EraseEnemyObject(x);
  }
}

function MoveESprRowOffscreen(x, a) {
  DumpTwoSpr(0xf8, add(a, ram[Enemy_SprDataOffset + x]));
}

function MoveESprColOffscreen(x, a) {
  const y = add(a, ram[Enemy_SprDataOffset + x]);
  MoveColOffscreen(y);
  ram[Sprite_Data + ((16 + y) & 0xff)] = 0xf8;
}

function MoveColOffscreen(y) {
  ram[sprY(y)] = 0xf8;
  ram[sprY(y + 8)] = 0xf8;
}

// -------------------------------------------------------------------------------------

function DrawBlock(x) {
  ram[0x02] = ram[Block_Rel_YPos];
  ram[0x05] = ram[Block_Rel_XPos];
  ram[0x04] = 0x03;
  ram[0x03] = 0x01;
  let y = ram[Block_SprDataOffset + x];
  for (let n = 0; n < 4; n += 2) {
    ram[0x00] = ROM[L.DefaultBlockObjTiles + n];
    ram[0x01] = ROM[L.DefaultBlockObjTiles + n + 1];
    y = DrawSpriteObject(y);
  }
  x = ram[ObjectOffset];
  y = ram[Block_SprDataOffset + x];
  if (ram[AreaType] !== 0x01) {
    ram[sprT(y)] = 0x86;
    ram[sprT(y + 4)] = 0x86;
  }
  if (ram[Block_Metatile + x] === 0xc4) {
    DumpFourSpr(0x87, y + 1);
    const a = ram[AreaType] === 0x01 ? 0x03 : 0x01;
    ram[sprA(y)] = a;
    ram[sprA(y + 4)] = a | 0x40;
    ram[sprA(y + 12)] = a | 0xc0;
    ram[sprA(y + 8)] = (a | 0xc0) & 0x83;
  }
  // BlkOffscr
  const bits = ram[Block_OffscreenBits];
  if (bits & 0x04) {
    ram[sprY(y + 4)] = 0xf8;
    ram[sprY(y + 12)] = 0xf8;
  }
  if (bits & 0x08) MoveColOffscreen(y);
}

function DrawBrickChunks(x) {
  let pal = 0x02;
  let tile = 0x75;
  if (ram[GameEngineSubroutine] !== 0x05) {
    pal = 0x03;
    tile = 0x84;
  }
  const y = ram[Block_SprDataOffset + x];
  DumpFourSpr(tile, y + 1);
  DumpFourSpr(((ram[FrameCounter] << 4) & 0xc0) | pal, y + 2);
  DumpTwoSpr(ram[Block_Rel_YPos], y);
  ram[sprX(y)] = ram[Block_Rel_XPos];
  ram[0x00] = sub(ram[Block_Orig_XPos + x], ram[ScreenLeft_X_Pos]);
  let a = sub(ram[0x00], ram[Block_Rel_XPos]);
  a = adc(a, ram[0x00]);
  a = adc(a, 0x06);
  ram[sprX(y + 4)] = a;
  ram[sprY(y + 8)] = ram[Block_Rel_YPos + 1];
  ram[sprY(y + 12)] = ram[Block_Rel_YPos + 1];
  ram[sprX(y + 8)] = ram[Block_Rel_XPos + 1];
  a = sub(ram[0x00], ram[Block_Rel_XPos + 1]);
  a = adc(a, ram[0x00]);
  a = adc(a, 0x06);
  ram[sprX(y + 12)] = a;
  if (ram[Block_OffscreenBits] & 0x08) MoveColOffscreen(y);
  if (ram[Block_OffscreenBits] & 0x80) DumpTwoSpr(0xf8, y);
  if (neg(ram[0x00]) && ram[sprX(y)] >= ram[sprX(y + 4)]) {
    ram[sprY(y + 4)] = 0xf8;
    ram[sprY(y + 12)] = 0xf8;
  }
}

function DrawFireball(x) {
  const y = ram[FBall_SprDataOffset + x];
  ram[sprY(y)] = ram[Fireball_Rel_YPos];
  ram[sprX(y)] = ram[Fireball_Rel_XPos];
  DrawFirebar(y);
}

function DrawFirebar(y) {
  const f = ram[FrameCounter] >> 2;
  ram[sprT(y)] = (f & 0x01) ^ 0x64;
  ram[sprA(y)] = (f & 0x02) ? 0xc2 : 0x02;
}

function DrawExplosion_Fireball(x) {
  const y = ram[Alt_SprDataOffset + x];
  const st = ram[Fireball_State + x];
  ram[Fireball_State + x] = (st + 1) & 0xff;
  const a = (st >> 1) & 0x07;
  if (a >= 0x03) {
    ram[Fireball_State + x] = 0;
    return;
  }
  DrawExplosion_Fireworks(a, y);
}

function DrawExplosion_Fireworks(a, y) {
  DumpFourSpr(ROM[L.ExplosionTiles + a], y + 1);
  const ry = sub(ram[Fireball_Rel_YPos], 0x04);
  ram[sprY(y)] = ry;
  ram[sprY(y + 8)] = ry;
  const ry2 = add(ry, 0x08);
  ram[sprY(y + 4)] = ry2;
  ram[sprY(y + 12)] = ry2;
  const rx = sub(ram[Fireball_Rel_XPos], 0x04);
  ram[sprX(y)] = rx;
  ram[sprX(y + 4)] = rx;
  const rx2 = add(rx, 0x08);
  ram[sprX(y + 8)] = rx2;
  ram[sprX(y + 12)] = rx2;
  ram[sprA(y)] = 0x02;
  ram[sprA(y + 4)] = 0x82;
  ram[sprA(y + 8)] = 0x42;
  ram[sprA(y + 12)] = 0xc2;
}

function DrawSmallPlatform(x) {
  const y = ram[Enemy_SprDataOffset + x];
  DumpSixSpr(0x5b, y + 1);
  DumpSixSpr(0x02, y + 2);
  const rx = ram[Enemy_Rel_XPos];
  ram[sprX(y)] = rx;
  ram[sprX(y + 12)] = rx;
  const rx8 = add(rx, 0x08);
  ram[sprX(y + 4)] = rx8;
  ram[sprX(y + 16)] = rx8;
  const rx16 = add(rx8, 0x08);
  ram[sprX(y + 8)] = rx16;
  ram[sprX(y + 20)] = rx16;
  const ey = ram[Enemy_Y_Position + x];
  DumpThreeSpr(ey < 0x20 ? 0xf8 : ey, y);
  let b = add(ey, 0x80);
  if (b < 0x20) b = 0xf8;
  ram[sprY(y + 12)] = b;
  ram[sprY(y + 16)] = b;
  ram[sprY(y + 20)] = b;
  const bits = ram[Enemy_OffscreenBits];
  if (bits & 0x08) {
    ram[sprY(y)] = 0xf8;
    ram[sprY(y + 12)] = 0xf8;
  }
  if (bits & 0x04) {
    ram[sprY(y + 4)] = 0xf8;
    ram[sprY(y + 16)] = 0xf8;
  }
  if (bits & 0x02) {
    ram[sprY(y + 8)] = 0xf8;
    ram[sprY(y + 20)] = 0xf8;
  }
}

function DrawBubble(x) {
  if (ram[Player_Y_HighPos] !== 0x01) return;
  if (ram[Bubble_OffscreenBits] & 0x08) return;
  const y = ram[Bubble_SprDataOffset + x];
  ram[sprX(y)] = ram[Bubble_Rel_XPos];
  ram[sprY(y)] = ram[Bubble_Rel_YPos];
  ram[sprT(y)] = 0x74;
  ram[sprA(y)] = 0x02;
}

// -------------------------------------------------------------------------------------

function PlayerGfxHandler() {
  if (ram[InjuryTimer] && (ram[FrameCounter] & 1)) return;
  if (ram[GameEngineSubroutine] === 0x0b) {
    PlayerGfxProcessing(ROM[L.PlayerGfxTblOffsets + 0x0e]);
    return;
  }
  if (ram[PlayerChangeSizeFlag]) {
    PlayerGfxProcessing(HandleChangeSize());
    return;
  }
  if (!ram[SwimmingFlag] || ram[Player_State] === 0) {
    PlayerGfxProcessing(ProcessPlayerAction());
    return;
  }
  PlayerGfxProcessing(ProcessPlayerAction());
  if (ram[FrameCounter] & 0x04) return;
  let x = 0;
  let y = ram[Player_SprDataOffset];
  if (!(ram[PlayerFacingDir] & 1)) y += 4;
  if (ram[PlayerSize]) {
    if (ram[sprT(y + 24)] === ROM[SwimTileRepOffset]) return;
    x++;
  }
  ram[sprT(y + 24)] = ROM[L.SwimKickTileNum + x];
}

function PlayerGfxProcessing(a) {
  ram[PlayerGfxOffset] = a;
  RenderPlayerSub(0x04);
  ChkForPlayerAttrib();
  if (ram[FireballThrowingTimer]) {
    const t = ram[PlayerAnimTimer];
    const lt = t < ram[FireballThrowingTimer];
    ram[FireballThrowingTimer] = 0;
    if (lt) {
      ram[FireballThrowingTimer] = t;
      ram[PlayerGfxOffset] = ROM[L.PlayerGfxTblOffsets + 0x07];
      const rows = (ram[Player_X_Speed] | ram[Left_Right_Buttons]) ? 0x03 : 0x04;
      RenderPlayerSub(rows);
    }
  }
  // PlayerOffscreenChk
  let bits = ram[Player_OffscreenBits] >> 4;
  let y = (ram[Player_SprDataOffset] + 0x18) & 0xff;
  for (let r = 3; r >= 0; r--) {
    if (bits & 1) DumpTwoSpr(0xf8, y);
    bits >>= 1;
    y = (y - 8) & 0xff;
  }
}

function DrawPlayer_Intermediate() {
  for (let x = 5; x >= 0; x--) ram[0x02 + x] = ROM[L.IntermediatePlayerData + x];
  DrawPlayerLoop(0xb8, 0x04);
  ram[Sprite_Attributes + 32] = ram[Sprite_Attributes + 36] | 0x40;
}

function RenderPlayerSub(rows) {
  ram[0x07] = rows;
  ram[Player_Pos_ForScroll] = ram[Player_Rel_XPos];
  ram[0x05] = ram[Player_Rel_XPos];
  ram[0x02] = ram[Player_Rel_YPos];
  ram[0x03] = ram[PlayerFacingDir];
  ram[0x04] = ram[Player_SprAttrib];
  DrawPlayerLoop(ram[PlayerGfxOffset], ram[Player_SprDataOffset]);
}

function DrawPlayerLoop(x, y) {
  do {
    ram[0x00] = ROM[L.PlayerGraphicsTable + x];
    ram[0x01] = ROM[L.PlayerGraphicsTable + x + 1];
    y = DrawSpriteObject(y);
    x += 2;
    ram[0x07] = (ram[0x07] - 1) & 0xff;
  } while (ram[0x07] !== 0);
}

function ProcessPlayerAction() {
  const s = ram[Player_State];
  if (s === 0x03) {
    // ActionClimbing
    if (ram[Player_Y_Speed] === 0) return NonAnimatedActs(0x05);
    return AnimationControl(GetGfxOffsetAdder(0x05), 0x02);
  }
  if (s === 0x02) {
    return GetCurrentAnimOffset(GetGfxOffsetAdder(0x04));
  }
  if (s === 0x01) {
    if (ram[SwimmingFlag]) {
      // ActionSwimming
      const y = GetGfxOffsetAdder(0x01);
      if ((ram[JumpSwimTimer] | ram[PlayerAnimCtrl]) || (ram[A_B_Buttons] & 0x80)) {
        return AnimationControl(y, 0x03);
      }
      return GetCurrentAnimOffset(y);
    }
    return NonAnimatedActs(ram[CrouchingFlag] ? 0x06 : 0x00);
  }
  // ProcOnGroundActs
  if (ram[CrouchingFlag]) return NonAnimatedActs(0x06);
  if (!(ram[Player_X_Speed] | ram[Left_Right_Buttons])) return NonAnimatedActs(0x02);
  if (ram[Player_XSpeedAbsolute] >= 0x09 && !(ram[Player_MovingDir] & ram[PlayerFacingDir])) {
    return NonAnimatedActs(0x03);
  }
  // ActionWalkRun
  return AnimationControl(GetGfxOffsetAdder(0x04), 0x03);
}

function NonAnimatedActs(y) {
  y = GetGfxOffsetAdder(y);
  ram[PlayerAnimCtrl] = 0;
  return ROM[L.PlayerGfxTblOffsets + y];
}

function GetCurrentAnimOffset(y) {
  return GetOffsetFromAnimCtrl(ram[PlayerAnimCtrl], y);
}

function AnimationControl(y, extent) {
  ram[0x00] = extent;
  const ofs = GetCurrentAnimOffset(y);
  if (!ram[PlayerAnimTimer]) {
    ram[PlayerAnimTimer] = ram[PlayerAnimTimerSet];
    let c = (ram[PlayerAnimCtrl] + 1) & 0xff;
    if (c >= ram[0x00]) c = 0;
    ram[PlayerAnimCtrl] = c;
  }
  return ofs;
}

function GetGfxOffsetAdder(y) {
  return ram[PlayerSize] ? y + 8 : y;
}

function HandleChangeSize() {
  let y = ram[PlayerAnimCtrl];
  if (!(ram[FrameCounter] & 0x03)) {
    y++;
    if (y >= 0x0a) {
      y = 0;
      ram[PlayerChangeSizeFlag] = 0;
    }
    ram[PlayerAnimCtrl] = y;
  }
  if (ram[PlayerSize] === 0) {
    return GetOffsetFromAnimCtrl(ROM[L.ChangeSizeOffsetAdder + y], 0x0f);
  }
  // ShrinkPlayer
  let t = 0x09;
  if (ROM[L.ChangeSizeOffsetAdder + y + 0x0a] === 0) t = 0x01;
  return ROM[L.PlayerGfxTblOffsets + t];
}

function GetOffsetFromAnimCtrl(a, y) {
  return ((a << 3) + ROM[L.PlayerGfxTblOffsets + y]) & 0xff;
}

function ChkForPlayerAttrib() {
  const y = ram[Player_SprDataOffset];
  let killed = ram[GameEngineSubroutine] === 0x0b;
  let rows4 = false;
  if (!killed) {
    const o = ram[PlayerGfxOffset];
    if (o === 0x50 || o === 0xb8 || o === 0xc0) rows4 = true;
    else if (o === 0xc8) killed = true;
    else return;
  }
  if (killed) {
    ram[sprA(y + 16)] &= 0x3f;
    ram[sprA(y + 20)] = (ram[sprA(y + 20)] & 0x3f) | 0x40;
  }
  ram[sprA(y + 24)] &= 0x3f;
  ram[sprA(y + 28)] = (ram[sprA(y + 28)] & 0x3f) | 0x40;
}

// -------------------------------------------------------------------------------------

function RelativePlayerPosition() {
  GetObjRelativePosition(0, 0);
}
function RelativeBubblePosition(x) {
  GetObjRelativePosition(x + 0x16, 0x03);
}
function RelativeFireballPosition(x) {
  GetObjRelativePosition(x + 0x07, 0x02);
}
function RelativeMiscPosition(x) {
  GetObjRelativePosition(x + 0x0d, 0x06);
}
function RelativeEnemyPosition(x) {
  GetObjRelativePosition(x + 0x01, 0x01);
}
function RelativeBlockPosition(x) {
  GetObjRelativePosition(x + 0x09, 0x04);
  GetObjRelativePosition(x + 0x0b, 0x05);
}

function GetObjRelativePosition(x, y) {
  ram[SprObject_Rel_YPos + y] = ram[SprObject_Y_Position + x];
  ram[SprObject_Rel_XPos + y] = sub(ram[SprObject_X_Position + x], ram[ScreenLeft_X_Pos]);
}

function GetPlayerOffscreenBits() {
  GetOffScreenBitsSet(0, 0);
}
function GetFireballOffscreenBits(x) {
  GetOffScreenBitsSet(x + 0x07, 0x02);
}
function GetBubbleOffscreenBits(x) {
  GetOffScreenBitsSet(x + 0x16, 0x03);
}
function GetMiscOffscreenBits(x) {
  GetOffScreenBitsSet(x + 0x0d, 0x06);
}
function GetEnemyOffscreenBits(x) {
  GetOffScreenBitsSet(x + 0x01, 0x01);
}
function GetBlockOffscreenBits(x) {
  GetOffScreenBitsSet(x + 0x09, 0x04);
}

function GetOffScreenBitsSet(x, y) {
  const a = RunOffscrBitsSubs(x);
  ram[0x00] = ((a << 4) | ram[0x00]) & 0xff;
  ram[SprObject_OffscrBits + y] = ram[0x00];
}

function RunOffscrBitsSubs(x) {
  ram[0x00] = GetXOffscreenBits(x) >> 4;
  return GetYOffscreenBits(x);
}

function GetXOffscreenBits(x) {
  ram[0x04] = x;
  let a = 0;
  for (let y = 1; y >= 0; y--) {
    ram[0x07] = sub(ram[ScreenEdge_X_Pos + y], ram[SprObject_X_Position + x]);
    const p = sbc(ram[ScreenEdge_PageLoc + y], ram[SprObject_PageLoc + x]);
    let o = ROM[L.DefaultXOnscreenOfs + y];
    if (!neg(p)) {
      o = ROM[L.DefaultXOnscreenOfs + y + 1];
      if (!(p >= 0x01 && p < 0x81)) {
        ram[0x06] = 0x38;
        o = DividePDiff(0x08, y, o);
      }
    }
    a = ROM[L.XOffscreenBitsData + o];
    if (a !== 0) return a;
  }
  return a;
}

function GetYOffscreenBits(x) {
  ram[0x04] = x;
  let a = 0;
  for (let y = 1; y >= 0; y--) {
    ram[0x07] = sub(ROM[L.HighPosUnitData + y], ram[SprObject_Y_Position + x]);
    const p = sbc(0x01, ram[SprObject_Y_HighPos + x]);
    let o = ROM[L.DefaultYOnscreenOfs + y];
    if (!neg(p)) {
      o = ROM[L.DefaultYOnscreenOfs + y + 1];
      if (!(p >= 0x01 && p < 0x81)) {
        ram[0x06] = 0x20;
        o = DividePDiff(0x04, y, o);
      }
    }
    a = ROM[L.YOffscreenBitsData + o];
    if (a !== 0) return a;
  }
  return a;
}

function DividePDiff(a, y, o) {
  ram[0x05] = a;
  if (ram[0x07] >= ram[0x06]) return o;
  let v = (ram[0x07] >> 3) & 0x07;
  if (y < 0x01) v = (v + ram[0x05]) & 0xff;
  return v;
}

// draws one row of two sprites using $00/$01 tiles, $02 Y, $03 flip, $04 attrib,
// $05 X. Returns the OAM offset of the next row.
function DrawSpriteObject(y) {
  let at;
  if (ram[0x03] & 0x02) {
    ram[sprT(y + 4)] = ram[0x00];
    ram[sprT(y)] = ram[0x01];
    at = 0x40;
  } else {
    ram[sprT(y)] = ram[0x00];
    ram[sprT(y + 4)] = ram[0x01];
    at = 0x00;
  }
  at |= ram[0x04];
  ram[sprA(y)] = at;
  ram[sprA(y + 4)] = at;
  ram[sprY(y)] = ram[0x02];
  ram[sprY(y + 4)] = ram[0x02];
  ram[sprX(y)] = ram[0x05];
  ram[sprX(y + 4)] = add(ram[0x05], 0x08);
  ram[0x02] = add(ram[0x02], 0x08);
  return (y + 8) & 0xff;
}
