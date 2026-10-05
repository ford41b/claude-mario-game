// Enemy objects: loading from level data, loop commands, frenzies, the init
// and movement routines of every enemy, platforms, firebars, Bowser and the
// end-of-level star flag. Port of EnemiesAndLoopsCore .. OffscreenBoundsCheck.
'use strict';

function EnemiesAndLoopsCore(x) {
  const f = ram[Enemy_Flag + x];
  if (f & 0x80) {
    const y = f & 0x0f;
    if (ram[Enemy_Flag + y] === 0) ram[Enemy_Flag + x] = 0;
    return;
  }
  if (f !== 0) {
    RunEnemyObjectsCore(x);
    return;
  }
  if ((ram[AreaParserTaskNum] & 0x07) === 0x07) return;
  ProcLoopCommand(x);
}

function ExecGameLoopback(y) {
  ram[Player_PageLoc] = (ram[Player_PageLoc] - 4) & 0xff;
  ram[CurrentPageLoc] = (ram[CurrentPageLoc] - 4) & 0xff;
  ram[ScreenLeft_PageLoc] = (ram[ScreenLeft_PageLoc] - 4) & 0xff;
  ram[ScreenRight_PageLoc] = (ram[ScreenRight_PageLoc] - 4) & 0xff;
  ram[AreaObjectPageLoc] = (ram[AreaObjectPageLoc] - 4) & 0xff;
  ram[EnemyObjectPageSel] = 0;
  ram[AreaObjectPageSel] = 0;
  ram[EnemyDataOffset] = 0;
  ram[EnemyObjectPageLoc] = 0;
  ram[AreaDataOffset] = ROM[L.AreaDataOfsLoopback + y];
}

function ProcLoopCommand(x) {
  if (ram[LoopCommand] && ram[CurrentColumnPos] === 0) {
    let y = 0x0b;
    for (;;) {
      y--;
      if (y < 0) break;
      if (ram[WorldNumber] !== ROM[L.LoopCmdWorldNumber + y]) continue;
      if (ram[CurrentPageLoc] !== ROM[L.LoopCmdPageNumber + y]) continue;
      let doLoop = false;
      let incMLoop = false;
      let initMLp = false;
      if (ram[Player_Y_Position] === ROM[L.LoopCmdYPosition + y] && ram[Player_State] === 0) {
        if (ram[WorldNumber] !== World7) initMLp = true;
        else {
          ram[MultiLoopCorrectCntr]++;
          incMLoop = true;
        }
      } else if (ram[WorldNumber] === World7) {
        incMLoop = true;
      } else {
        doLoop = true;
      }
      if (incMLoop) {
        ram[MultiLoopPassCntr]++;
        if (ram[MultiLoopPassCntr] !== 0x03) {
          ram[LoopCommand] = 0;
          break;
        }
        if (ram[MultiLoopCorrectCntr] === 0x03) initMLp = true;
        else doLoop = true;
      }
      if (doLoop) {
        ExecGameLoopback(y);
        KillAllEnemies();
      }
      ram[MultiLoopPassCntr] = 0;
      ram[MultiLoopCorrectCntr] = 0;
      ram[LoopCommand] = 0;
      break;
    }
  }
  // ChkEnemyFrenzy
  if (ram[EnemyFrenzyQueue]) {
    ram[Enemy_ID + x] = ram[EnemyFrenzyQueue];
    ram[Enemy_Flag + x] = 0x01;
    ram[Enemy_State + x] = 0;
    ram[EnemyFrenzyQueue] = 0;
    InitEnemyObject(x, 0);
    return;
  }
  ProcessEnemyData(x);
}

function ProcessEnemyData(x) {
  let y = ram[EnemyDataOffset];
  const b0 = enemyByte(y);
  if (b0 === 0xff) {
    CheckFrenzyBuffer(x, y);
    return;
  }
  if ((b0 & 0x0f) !== 0x0e && x >= 0x05) {
    if ((enemyByte(y + 1) & 0x3f) !== 0x2e) return;
  }
  // CheckRightBounds
  ram[0x07] = add(ram[ScreenRight_X_Pos], 0x30) & 0xf0;
  ram[0x06] = adc(ram[ScreenRight_PageLoc], 0x00);
  y = ram[EnemyDataOffset] + 1;
  if ((enemyByte(y) & 0x80) && !ram[EnemyObjectPageSel]) {
    ram[EnemyObjectPageSel]++;
    ram[EnemyObjectPageLoc]++;
  }
  // CheckPageCtrlRow
  y--;
  if ((enemyByte(y) & 0x0f) === 0x0f && !ram[EnemyObjectPageSel]) {
    ram[EnemyObjectPageLoc] = enemyByte(y + 1) & 0x3f;
    ram[EnemyDataOffset] = (ram[EnemyDataOffset] + 2) & 0xff;
    ram[EnemyObjectPageSel]++;
    ProcLoopCommand(x);
    return;
  }
  // PositionEnemyObj
  ram[Enemy_PageLoc + x] = ram[EnemyObjectPageLoc];
  const col = enemyByte(y) & 0xf0;
  ram[Enemy_X_Position + x] = col;
  cmp(col, ram[ScreenRight_X_Pos]);
  sbc(ram[Enemy_PageLoc + x], ram[ScreenRight_PageLoc]);
  if (!C) {
    if ((enemyByte(y) & 0x0f) === 0x0e) {
      ParseRow0e(x, y);
      return;
    }
    CheckThreeBytes(x);
    return;
  }
  // CheckRightExtBounds
  cmp(ram[0x07], ram[Enemy_X_Position + x]);
  sbc(ram[0x06], ram[Enemy_PageLoc + x]);
  if (!C) {
    CheckFrenzyBuffer(x, y);
    return;
  }
  ram[Enemy_Y_HighPos + x] = 0x01;
  const yp = (enemyByte(y) << 4) & 0xff;
  ram[Enemy_Y_Position + x] = yp;
  if (yp === 0xe0) {
    ParseRow0e(x, y);
    return;
  }
  y++;
  if ((enemyByte(y) & 0x40) && !ram[SecondaryHardMode]) {
    Inc2B();
    return;
  }
  // CheckForEnemyGroup
  let id = enemyByte(y) & 0x3f;
  if (id >= 0x37 && id < 0x3f) {
    HandleGroupEnemies(x, id);
    return;
  }
  // BuzzyBeetleMutate
  if (id === Goomba && ram[PrimaryHardMode]) id = BuzzyBeetle;
  ram[Enemy_ID + x] = id;
  ram[Enemy_Flag + x] = 0x01;
  InitEnemyObject(x, y);
  if (ram[Enemy_Flag + x]) Inc2B();
}

function CheckFrenzyBuffer(x, y) {
  let a = ram[EnemyFrenzyBuffer];
  if (!a) {
    if (ram[VineFlagOffset] !== 0x01) return;
    a = VineObject;
  }
  ram[Enemy_ID + x] = a;
  InitEnemyObject(x, y);
}

function InitEnemyObject(x, y) {
  ram[Enemy_State + x] = 0;
  CheckpointEnemyID(x, y);
}

function ParseRow0e(x, y) {
  const b2 = enemyByte(y + 2);
  if ((b2 >> 5) === ram[WorldNumber]) {
    ram[AreaPointer] = enemyByte(y + 1);
    ram[EntrancePage] = b2 & 0x1f;
  }
  Inc3B();
}

function CheckThreeBytes() {
  if ((enemyByte(ram[EnemyDataOffset]) & 0x0f) === 0x0e) Inc3B();
  else Inc2B();
}
function Inc3B() {
  ram[EnemyDataOffset]++;
  Inc2B();
}
function Inc2B() {
  ram[EnemyDataOffset] = (ram[EnemyDataOffset] + 2) & 0xff;
  ram[EnemyObjectPageSel] = 0;
}

function CheckpointEnemyID(x, y) {
  const id = ram[Enemy_ID + x];
  if (id < 0x15) {
    ram[Enemy_Y_Position + x] = add(ram[Enemy_Y_Position + x], 0x08);
    ram[EnemyOffscrBitsMasked + x] = 0x01;
  }
  C = 0; // JumpEngine's ASL
  InitEnemyRoutine(x, id, y === undefined ? 0 : y);
}

function InitEnemyRoutine(x, id, y) {
  switch (id) {
    case 0x00: case 0x01: case 0x02: InitNormalEnemy(x); break;
    case 0x03: InitRedKoopa(x); break;
    case 0x05: InitHammerBro(x); break;
    case 0x06: InitGoomba(x); break;
    case 0x07: InitBloober(x); break;
    case 0x08: InitBulletBill(x); break;
    case 0x0a: case 0x0b: InitCheepCheep(x); break;
    case 0x0c: InitPodoboo(x); break;
    case 0x0d: InitPiranhaPlant(x); break;
    case 0x0e: InitJumpGPTroopa(x); break;
    case 0x0f: InitRedPTroopa(x); break;
    case 0x10: InitHorizFlySwimEnemy(x); break;
    case 0x11: InitLakitu(x); break;
    case 0x12: case 0x14: case 0x15: case 0x16: case 0x17: InitEnemyFrenzy(x); break;
    case 0x18: EndFrenzy(x); break;
    case 0x1b: case 0x1c: case 0x1d: case 0x1e: InitShortFirebar(x); break;
    case 0x1f: InitLongFirebar(x); break;
    case 0x24: InitBalPlatform(x); break;
    case 0x25: InitVertPlatform(x); break;
    case 0x26: LargeLiftUp(x); break;
    case 0x27: LargeLiftDown(x); break;
    case 0x28: case 0x2a: InitHoriPlatform(x); break;
    case 0x29: InitDropPlatform(x); break;
    case 0x2b: PlatLiftUp(x); break;
    case 0x2c: PlatLiftDown(x); break;
    case 0x2d: InitBowser(x); break;
    case 0x2e: PwrUpJmp(); break;
    case 0x2f: Setup_Vine(x, y); break;
    case 0x35: InitRetainerObj(x); break;
    default: break;
  }
}

// -------------------------------------------------------------------------------------

function InitGoomba(x) {
  InitNormalEnemy(x);
  SmallBBox(x);
}

function InitPodoboo(x) {
  ram[Enemy_Y_HighPos + x] = 0x02;
  ram[Enemy_Y_Position + x] = 0x02;
  ram[EnemyIntervalTimer + x] = 0x01;
  ram[Enemy_State + x] = 0x00;
  SmallBBox(x);
}

function InitRetainerObj(x) {
  ram[Enemy_Y_Position + x] = 0xb8;
}

function InitNormalEnemy(x) {
  const y = ram[PrimaryHardMode] ? 1 : 0;
  ram[Enemy_X_Speed + x] = ROM[L.NormalXSpdData + y];
  TallBBox(x);
}

function InitRedKoopa(x) {
  InitNormalEnemy(x);
  ram[Enemy_State + x] = 0x01;
}

function InitHammerBro(x) {
  ram[HammerThrowingTimer + x] = 0;
  ram[Enemy_X_Speed + x] = 0;
  ram[EnemyIntervalTimer + x] = ROM[L.HBroWalkingTimerData + ram[SecondaryHardMode]];
  SetBBox(x, 0x0b);
}

function InitHorizFlySwimEnemy(x) {
  ram[Enemy_X_Speed + x] = 0;
  TallBBox(x);
}

function InitBloober(x) {
  ram[BlooperMoveSpeed + x] = 0;
  SmallBBox(x);
}

function SmallBBox(x) {
  SetBBox(x, 0x09);
}

function InitRedPTroopa(x) {
  let y = 0x30;
  const yp = ram[Enemy_Y_Position + x];
  ram[RedPTroopaOrigXPos + x] = yp;
  if (neg(yp)) y = 0xe0;
  ram[RedPTroopaCenterYPos + x] = adc(y, yp);
  TallBBox(x);
}

function TallBBox(x) {
  SetBBox(x, 0x03);
}

function SetBBox(x, a) {
  ram[Enemy_BoundBoxCtrl + x] = a;
  ram[Enemy_MovingDir + x] = 0x02;
  InitVStf(x);
}

function InitVStf(x) {
  ram[Enemy_Y_Speed + x] = 0;
  ram[Enemy_Y_MoveForce + x] = 0;
  return 0;
}

function InitBulletBill(x) {
  ram[Enemy_MovingDir + x] = 0x02;
  ram[Enemy_BoundBoxCtrl + x] = 0x09;
}

function InitCheepCheep(x) {
  SmallBBox(x);
  ram[CheepCheepMoveMFlag + x] = ram[PseudoRandomBitReg + x] & 0x10;
  ram[CheepCheepOrigYPos + x] = ram[Enemy_Y_Position + x];
}

function InitLakitu(x) {
  if (ram[EnemyFrenzyBuffer]) {
    EraseEnemyObject(x);
    return;
  }
  SetupLakitu(x);
}

function SetupLakitu(x) {
  ram[LakituReappearTimer] = 0;
  InitHorizFlySwimEnemy(x);
  TallBBox2(x);
}

function LakituAndSpinyHandler(x) {
  if (ram[FrenzyEnemyTimer]) return;
  if (x >= 0x05) return;
  ram[FrenzyEnemyTimer] = 0x80;
  for (let y = 4; y >= 0; y--) {
    if (ram[Enemy_ID + y] === Lakitu) {
      CreateSpiny(x, y);
      return;
    }
  }
  ram[LakituReappearTimer]++;
  if (ram[LakituReappearTimer] < 0x07) return;
  for (let e = 4; e >= 0; e--) {
    if (ram[Enemy_Flag + e] === 0) {
      ram[Enemy_State + e] = 0;
      ram[Enemy_ID + e] = Lakitu;
      SetupLakitu(e);
      PutAtRightExtent(e, 0x20);
      return;
    }
  }
}

function CreateSpiny(x, y) {
  if (ram[Player_Y_Position] < 0x2c) return;
  if (ram[Enemy_State + y]) return;
  ram[Enemy_PageLoc + x] = ram[Enemy_PageLoc + y];
  ram[Enemy_X_Position + x] = ram[Enemy_X_Position + y];
  ram[Enemy_Y_HighPos + x] = 0x01;
  ram[Enemy_Y_Position + x] = sub(ram[Enemy_Y_Position + y], 0x08);
  let r = ram[PseudoRandomBitReg + x] & 0x03;
  for (let n = 2; n >= 0; n--) {
    ram[0x01 + n] = ROM[L.PRDiffAdjustData + r];
    r += 4;
  }
  PlayerLakituDiff(x);
  // the computed speed is discarded by SmallBBox (A=0 afterwards)
  SmallBBox(x);
  ram[Enemy_X_Speed + x] = 0;
  ram[Enemy_MovingDir + x] = 0x01;
  ram[Enemy_Y_Speed + x] = 0xfd;
  ram[Enemy_Flag + x] = 0x01;
  ram[Enemy_State + x] = 0x05;
}

function InitLongFirebar(x) {
  DuplicateEnemyObj(x);
  InitShortFirebar(x);
}

function InitShortFirebar(x) {
  ram[FirebarSpinState_Low + x] = 0;
  const y = ram[Enemy_ID + x] - 0x1b;
  ram[FirebarSpinSpeed + x] = ROM[L.FirebarSpinSpdData + y];
  ram[FirebarSpinDirection + x] = ROM[L.FirebarSpinDirData + y];
  ram[Enemy_Y_Position + x] = add(ram[Enemy_Y_Position + x], 0x04);
  ram[Enemy_X_Position + x] = add(ram[Enemy_X_Position + x], 0x04);
  ram[Enemy_PageLoc + x] = adc(ram[Enemy_PageLoc + x], 0x00);
  TallBBox2(x);
}

function InitFlyingCheepCheep(x) {
  if (ram[FrenzyEnemyTimer]) return;
  SmallBBox(x);
  ram[FrenzyEnemyTimer] = ROM[L.FlyCCTimerData + (ram[PseudoRandomBitReg + 1 + x] & 0x03)];
  let y = 0x03;
  if (ram[SecondaryHardMode]) y++;
  ram[0x00] = y;
  if (x >= ram[0x00]) return;
  const r = ram[PseudoRandomBitReg + x] & 0x03;
  ram[0x00] = r;
  ram[0x01] = r;
  ram[Enemy_Y_Speed + x] = 0xfb;
  let a = 0;
  const pxs = ram[Player_X_Speed];
  if (pxs) {
    a = 0x04;
    if (pxs >= 0x19) a <<= 1;
  }
  const saved = a;
  ram[0x00] = add(a, ram[0x00]);
  if (ram[PseudoRandomBitReg + 1 + x] & 0x03) ram[0x00] = ram[PseudoRandomBitReg + 2 + x] & 0x0f;
  y = add(saved, ram[0x01]);
  ram[Enemy_X_Speed + x] = ROM[L.FlyCCXSpeedData + y];
  ram[Enemy_MovingDir + x] = 0x01;
  if (!ram[Player_X_Speed]) {
    y = ram[0x00];
    if (y & 0x02) {
      ram[Enemy_X_Speed + x] = twos(ram[Enemy_X_Speed + x]);
      ram[Enemy_MovingDir + x]++;
    }
  }
  // D2XPos1
  let page;
  if (y & 0x02) {
    ram[Enemy_X_Position + x] = add(ram[Player_X_Position], ROM[L.FlyCCXPositionData + y]);
    page = adc(ram[Player_PageLoc], 0x00);
  } else {
    ram[Enemy_X_Position + x] = sub(ram[Player_X_Position], ROM[L.FlyCCXPositionData + y]);
    page = sbc(ram[Player_PageLoc], 0x00);
  }
  ram[Enemy_PageLoc + x] = page;
  ram[Enemy_Flag + x] = 0x01;
  ram[Enemy_Y_HighPos + x] = 0x01;
  ram[Enemy_Y_Position + x] = 0xf8;
}

function InitBowser(x) {
  DuplicateEnemyObj(x);
  ram[BowserFront_Offset] = x;
  ram[BowserBodyControls] = 0;
  ram[BridgeCollapseOffset] = 0;
  ram[BowserOrigXPos] = ram[Enemy_X_Position + x];
  ram[BowserFireBreathTimer] = 0xdf;
  ram[Enemy_MovingDir + x] = 0xdf;
  ram[BowserFeetCounter] = 0x20;
  ram[EnemyFrameTimer + x] = 0x20;
  ram[BowserHitPoints] = 0x05;
  ram[BowserMovementSpeed] = 0x02;
}

function DuplicateEnemyObj(x) {
  let y = 0;
  while (ram[Enemy_Flag + y] && y < 6) y++;
  ram[DuplicateObj_Offset] = y;
  ram[Enemy_Flag + y] = x | 0x80;
  ram[Enemy_PageLoc + y] = ram[Enemy_PageLoc + x];
  ram[Enemy_X_Position + y] = ram[Enemy_X_Position + x];
  ram[Enemy_Flag + x] = 0x01;
  ram[Enemy_Y_HighPos + y] = 0x01;
  ram[Enemy_Y_Position + y] = ram[Enemy_Y_Position + x];
}

function InitBowserFlame(x) {
  if (ram[FrenzyEnemyTimer]) return;
  ram[Enemy_Y_MoveForce + x] = 0;
  ram[NoiseSoundQueue] |= Sfx_BowserFlame;
  const y = ram[BowserFront_Offset];
  if (ram[Enemy_ID + y] === Bowser) {
    SpawnFromMouth(x, y);
    return;
  }
  let a = add(SetFlameTimer(), 0x20);
  if (ram[SecondaryHardMode]) a = sub(a, 0x10);
  ram[FrenzyEnemyTimer] = a;
  const r = ram[PseudoRandomBitReg + x] & 0x03;
  ram[BowserFlamePRandomOfs + x] = r;
  PutAtRightExtent(x, ROM[L.FlameYPosData + r]);
}

function PutAtRightExtent(x, a) {
  ram[Enemy_Y_Position + x] = a;
  ram[Enemy_X_Position + x] = add(ram[ScreenRight_X_Pos], 0x20);
  ram[Enemy_PageLoc + x] = adc(ram[ScreenRight_PageLoc], 0x00);
  return FinishFlame(x);
}

function SpawnFromMouth(x, y) {
  ram[Enemy_X_Position + x] = sub(ram[Enemy_X_Position + y], 0x0e);
  ram[Enemy_PageLoc + x] = ram[Enemy_PageLoc + y];
  ram[Enemy_Y_Position + x] = add(ram[Enemy_Y_Position + y], 0x08);
  const r = ram[PseudoRandomBitReg + x] & 0x03;
  ram[Enemy_YMF_Dummy + x] = r;
  const fy = ROM[L.FlameYPosData + r];
  const yy = fy < ram[Enemy_Y_Position + x] ? 0 : 1;
  ram[Enemy_Y_MoveForce + x] = ROM[L.FlameYMFAdderData + yy];
  ram[EnemyFrenzyBuffer] = 0;
  FinishFlame(x);
}

function FinishFlame(x) {
  ram[Enemy_BoundBoxCtrl + x] = 0x08;
  ram[Enemy_Y_HighPos + x] = 0x01;
  ram[Enemy_Flag + x] = 0x01;
  ram[Enemy_X_MoveForce + x] = 0;
  ram[Enemy_State + x] = 0;
  return 0;
}

function InitFireworks(x) {
  if (ram[FrenzyEnemyTimer]) return;
  ram[FrenzyEnemyTimer] = 0x20;
  ram[FireworksCounter]--;
  let y = 6;
  do {
    y--;
  } while (y > 0 && ram[Enemy_ID + y] !== StarFlagObject);
  const sx = sub(ram[Enemy_X_Position + y], 0x30);
  ram[0x00] = sbc(ram[Enemy_PageLoc + y], 0x00);
  const o = add(ram[FireworksCounter], ram[Enemy_State + y]);
  ram[Enemy_X_Position + x] = add(sx, ROM[L.FireworksXPosData + o]);
  ram[Enemy_PageLoc + x] = adc(ram[0x00], 0x00);
  ram[Enemy_Y_Position + x] = ROM[L.FireworksYPosData + o];
  ram[Enemy_Y_HighPos + x] = 0x01;
  ram[Enemy_Flag + x] = 0x01;
  ram[ExplosionGfxCounter + x] = 0;
  ram[ExplosionTimerCounter + x] = 0x08;
}

function BulletBillCheepCheep(x) {
  if (ram[FrenzyEnemyTimer]) return;
  let id;
  if (ram[AreaType] !== 0) {
    // DoBulletBills
    for (let y = 0; y < 5; y++) {
      if (ram[Enemy_Flag + y] && ram[Enemy_ID + y] === BulletBill_FrenzyVar) return;
    }
    ram[Square2SoundQueue] |= Sfx_Blast;
    id = BulletBill_FrenzyVar;
  } else {
    if (x >= 0x03) return;
    let y = 0;
    if (ram[PseudoRandomBitReg + x] >= 0xaa) y++;
    if (ram[WorldNumber] !== World2) y++;
    id = ROM[L.SwimCC_IDData + (y & 1)];
  }
  // Set17ID
  ram[Enemy_ID + x] = id;
  if (ram[BitMFilter] === 0xff) ram[BitMFilter] = 0;
  let y = ram[PseudoRandomBitReg + x] & 0x07;
  while (ROM[L.Bitmasks + y] & ram[BitMFilter]) y = (y + 1) & 0x07;
  ram[BitMFilter] |= ROM[L.Bitmasks + y];
  ram[Enemy_YMF_Dummy + x] = PutAtRightExtent(x, ROM[L.Enemy17YPosData + y]);
  ram[FrenzyEnemyTimer] = 0x20;
  CheckpointEnemyID(x, y);
}

function HandleGroupEnemies(x, a) {
  let id = 0; // green koopa
  a = sub(a, 0x37);
  const first = a;
  if (a < 0x04) id = ram[PrimaryHardMode] ? BuzzyBeetle : Goomba;
  ram[0x01] = id;
  ram[0x00] = (a & 0x02) ? 0x70 : 0xb0;
  ram[0x02] = ram[ScreenRight_PageLoc];
  ram[0x03] = ram[ScreenRight_X_Pos];
  ram[NumberofGroupEnemies] = (first & 1) ? 3 : 2;
  for (;;) {
    let e = 0;
    while (e < 5 && ram[Enemy_Flag + e]) e++;
    if (e >= 5) break;
    ram[Enemy_ID + e] = ram[0x01];
    ram[Enemy_PageLoc + e] = ram[0x02];
    ram[Enemy_X_Position + e] = ram[0x03];
    ram[0x03] = add(ram[0x03], 0x18);
    ram[0x02] = adc(ram[0x02], 0x00);
    ram[Enemy_Y_Position + e] = ram[0x00];
    ram[Enemy_Y_HighPos + e] = 0x01;
    ram[Enemy_Flag + e] = 0x01;
    CheckpointEnemyID(e, 0);
    if (decRam(NumberofGroupEnemies) === 0) break;
  }
  Inc2B();
}

function InitPiranhaPlant(x) {
  ram[PiranhaPlant_Y_Speed + x] = 0x01;
  ram[Enemy_State + x] = 0;
  ram[PiranhaPlant_MoveFlag + x] = 0;
  const yp = ram[Enemy_Y_Position + x];
  ram[PiranhaPlantDownYPos + x] = yp;
  ram[PiranhaPlantUpYPos + x] = sub(yp, 0x18);
  SetBBox2(x, 0x09);
}

function InitEnemyFrenzy(x) {
  const id = ram[Enemy_ID + x];
  ram[EnemyFrenzyBuffer] = id;
  switch (id - 0x12) {
    case 0: LakituAndSpinyHandler(x); break;
    case 2: InitFlyingCheepCheep(x); break;
    case 3: InitBowserFlame(x); break;
    case 4: InitFireworks(x); break;
    case 5: BulletBillCheepCheep(x); break;
    default: break;
  }
}

function EndFrenzy(x) {
  for (let y = 5; y >= 0; y--) {
    if (ram[Enemy_ID + y] === Lakitu) ram[Enemy_State + y] = 0x01;
  }
  ram[EnemyFrenzyBuffer] = 0;
  ram[Enemy_Flag + x] = 0;
}

function InitJumpGPTroopa(x) {
  ram[Enemy_MovingDir + x] = 0x02;
  ram[Enemy_X_Speed + x] = 0xf8;
  TallBBox2(x);
}

function TallBBox2(x) {
  SetBBox2(x, 0x03);
}
function SetBBox2(x, a) {
  ram[Enemy_BoundBoxCtrl + x] = a;
}

function InitBalPlatform(x) {
  ram[Enemy_Y_Position + x] = (ram[Enemy_Y_Position + x] - 2) & 0xff;
  if (!ram[SecondaryHardMode]) PosPlatform(x, 0x02);
  let y = 0xff;
  const a = ram[BalPlatformAlignment];
  ram[Enemy_State + x] = a;
  if (neg(a)) y = x;
  ram[BalPlatformAlignment] = y;
  ram[Enemy_MovingDir + x] = 0;
  PosPlatform(x, 0);
  InitDropPlatform(x);
}

function InitDropPlatform(x) {
  ram[PlatformCollisionFlag + x] = 0xff;
  CommonPlatCode(x);
}

function InitHoriPlatform(x) {
  ram[XMoveSecondaryCounter + x] = 0;
  CommonPlatCode(x);
}

function InitVertPlatform(x) {
  let y = 0x40;
  let a = ram[Enemy_Y_Position + x];
  if (neg(a)) {
    a = twos(a);
    y = 0xc0;
  }
  ram[YPlatformTopYPos + x] = a;
  ram[YPlatformCenterYPos + x] = add(y, ram[Enemy_Y_Position + x]);
  CommonPlatCode(x);
}

function CommonPlatCode(x) {
  InitVStf(x);
  SPBBox(x);
}

function SPBBox(x) {
  let a = 0x05;
  if (ram[AreaType] !== 0x03 && !ram[SecondaryHardMode]) a = 0x06;
  ram[Enemy_BoundBoxCtrl + x] = a;
}

function LargeLiftUp(x) {
  PlatLiftUp(x);
  SPBBox(x);
}
function LargeLiftDown(x) {
  PlatLiftDown(x);
  SPBBox(x);
}
function PlatLiftUp(x) {
  ram[Enemy_Y_MoveForce + x] = 0x10;
  ram[Enemy_Y_Speed + x] = 0xff;
  CommonSmallLift(x);
}
function PlatLiftDown(x) {
  ram[Enemy_Y_MoveForce + x] = 0xf0;
  ram[Enemy_Y_Speed + x] = 0x00;
  CommonSmallLift(x);
}
function CommonSmallLift(x) {
  PosPlatform(x, 0x01);
  ram[Enemy_BoundBoxCtrl + x] = 0x04;
}

function PosPlatform(x, y) {
  ram[Enemy_X_Position + x] = add(ram[Enemy_X_Position + x], ROM[L.PlatPosDataLow + y]);
  ram[Enemy_PageLoc + x] = adc(ram[Enemy_PageLoc + x], ROM[L.PlatPosDataHigh + y]);
}

// -------------------------------------------------------------------------------------

function RunEnemyObjectsCore(x) {
  x = ram[ObjectOffset];
  const id = ram[Enemy_ID + x];
  if (id < 0x15) {
    RunNormalEnemies(x);
    return;
  }
  switch (id) {
    case 0x15: RunBowserFlame(x); break;
    case 0x16: RunFireworks(x); break;
    case 0x1b: case 0x1c: case 0x1d: case 0x1e: case 0x1f:
    case 0x20: case 0x21: case 0x22:
      RunFirebarObj(x);
      break;
    case 0x24: case 0x25: case 0x26: case 0x27: case 0x28: case 0x29: case 0x2a:
      RunLargePlatform(x);
      break;
    case 0x2b: case 0x2c: RunSmallPlatform(x); break;
    case 0x2d: RunBowser(x); break;
    case 0x2e: PowerUpObjHandler(); break;
    case 0x2f: VineObjectHandler(x); break;
    case 0x31: RunStarFlagObj(x); break;
    case 0x32: JumpspringHandler(x); break;
    case 0x34: WarpZoneObject(x); break;
    case 0x35: RunRetainerObj(x); break;
    default: break;
  }
}

function RunRetainerObj(x) {
  GetEnemyOffscreenBits(x);
  RelativeEnemyPosition(x);
  EnemyGfxHandler(x);
}

function RunNormalEnemies(x) {
  ram[Enemy_SprAttrib + x] = 0;
  GetEnemyOffscreenBits(x);
  RelativeEnemyPosition(x);
  EnemyGfxHandler(x);
  GetEnemyBoundBox(x);
  EnemyToBGCollisionDet(x);
  EnemiesCollision(x);
  PlayerEnemyCollision(x);
  if (!ram[TimerControl]) EnemyMovementSubs(x);
  OffscreenBoundsCheck(x);
}

function EnemyMovementSubs(x) {
  switch (ram[Enemy_ID + x]) {
    case 0x00: case 0x01: case 0x02: case 0x03: case 0x04: case 0x06: case 0x12:
      MoveNormalEnemy(x);
      break;
    case 0x05: ProcHammerBro(x); break;
    case 0x07: MoveBloober(x); break;
    case 0x08: MoveBulletBill(x); break;
    case 0x0a: case 0x0b: MoveSwimmingCheepCheep(x); break;
    case 0x0c: MovePodoboo(x); break;
    case 0x0d: MovePiranhaPlant(x); break;
    case 0x0e: MoveJumpingEnemy(x); break;
    case 0x0f: ProcMoveRedPTroopa(x); break;
    case 0x10: MoveFlyGreenPTroopa(x); break;
    case 0x11: MoveLakitu(x); break;
    case 0x14: MoveFlyingCheepCheep(x); break;
    default: break;
  }
}

function RunBowserFlame(x) {
  ProcBowserFlame(x);
  GetEnemyOffscreenBits(x);
  RelativeEnemyPosition(x);
  GetEnemyBoundBox(x);
  PlayerEnemyCollision(x);
  OffscreenBoundsCheck(x);
}

function RunFirebarObj(x) {
  ProcFirebar(x);
  OffscreenBoundsCheck(x);
}

function RunSmallPlatform(x) {
  GetEnemyOffscreenBits(x);
  RelativeEnemyPosition(x);
  SmallPlatformBoundBox(x);
  SmallPlatformCollision(x);
  RelativeEnemyPosition(x);
  DrawSmallPlatform(x);
  MoveSmallPlatform(x);
  OffscreenBoundsCheck(x);
}

function RunLargePlatform(x) {
  GetEnemyOffscreenBits(x);
  RelativeEnemyPosition(x);
  LargePlatformBoundBox(x);
  LargePlatformCollision(x);
  if (!ram[TimerControl]) LargePlatformSubroutines(x);
  RelativeEnemyPosition(x);
  DrawLargePlatform(x);
  OffscreenBoundsCheck(x);
}

function LargePlatformSubroutines(x) {
  switch (ram[Enemy_ID + x] - 0x24) {
    case 0: BalancePlatform(x); break;
    case 1: YMovingPlatform(x); break;
    case 2: case 3: MoveLargeLiftPlat(x); break;
    case 4: XMovingPlatform(x); break;
    case 5: DropPlatform(x); break;
    case 6: RightPlatform(x); break;
  }
}

function EraseEnemyObject(x) {
  ram[Enemy_Flag + x] = 0;
  ram[Enemy_ID + x] = 0;
  ram[Enemy_State + x] = 0;
  ram[FloateyNum_Control + x] = 0;
  ram[EnemyIntervalTimer + x] = 0;
  ram[ShellChainCounter + x] = 0;
  ram[Enemy_SprAttrib + x] = 0;
  ram[EnemyFrameTimer + x] = 0;
  return 0;
}

// -------------------------------------------------------------------------------------

function MovePodoboo(x) {
  if (!ram[EnemyIntervalTimer + x]) {
    InitPodoboo(x);
    const a = ram[PseudoRandomBitReg + 1 + x] | 0x80;
    ram[Enemy_Y_MoveForce + x] = a;
    ram[EnemyIntervalTimer + x] = (a & 0x0f) | 0x06;
    ram[Enemy_Y_Speed + x] = 0xf9;
  }
  MoveJ_EnemyVertically(x);
}

function ProcHammerBro(x) {
  if (ram[Enemy_State + x] & 0x20) {
    MoveDefeatedEnemy(x);
    return;
  }
  if (ram[HammerBroJumpTimer + x] === 0) {
    HammerBroJumpCode(x);
    return;
  }
  ram[HammerBroJumpTimer + x]--;
  if (!(ram[Enemy_OffscreenBits] & 0x0c)) {
    if (ram[HammerThrowingTimer + x] === 0) {
      ram[HammerThrowingTimer + x] = ROM[L.HammerThrowTmrData + ram[SecondaryHardMode]];
      if (SpawnHammerObj()) {
        ram[Enemy_State + x] |= 0x08;
        MoveHammerBroXDir(x);
        return;
      }
    }
    ram[HammerThrowingTimer + x] = (ram[HammerThrowingTimer + x] - 1) & 0xff;
  }
  MoveHammerBroXDir(x);
}

function HammerBroJumpCode(x) {
  if ((ram[Enemy_State + x] & 0x07) === 0x01) {
    MoveHammerBroXDir(x);
    return;
  }
  ram[0x00] = 0;
  let y = 0xfa;
  const yp = ram[Enemy_Y_Position + x];
  if (!neg(yp)) {
    y = 0xfd;
    ram[0x00]++;
    if (yp >= 0x70) {
      ram[0x00]--;
      if (!(ram[PseudoRandomBitReg + 1 + x] & 0x01)) y = 0xfa;
    }
  }
  SetHJ(x, y);
}

function SetHJ(x, y) {
  ram[Enemy_Y_Speed + x] = y;
  ram[Enemy_State + x] |= 0x01;
  let o = ram[0x00] & ram[PseudoRandomBitReg + 2 + x];
  if (!ram[SecondaryHardMode]) o = 0;
  ram[EnemyFrameTimer + x] = ROM[L.HammerBroJumpLData + o];
  ram[HammerBroJumpTimer + x] = ram[PseudoRandomBitReg + 1 + x] | 0xc0;
  MoveHammerBroXDir(x);
}

function MoveHammerBroXDir(x) {
  ram[Enemy_X_Speed + x] = (ram[FrameCounter] & 0x40) ? 0xfc : 0x04;
  let y = 0x01;
  if (!neg(PlayerEnemyDiff(x))) {
    y++;
    if (!ram[EnemyIntervalTimer + x]) ram[Enemy_X_Speed + x] = 0xf8;
  }
  ram[Enemy_MovingDir + x] = y;
  MoveNormalEnemy(x);
}

function MoveNormalEnemy(x) {
  let y = 0;
  const st = ram[Enemy_State + x];
  let path; // 'fall' | 'steady' | 'defeated' | 'revive'
  if (st & 0x40) path = 'fall';
  else if (st & 0x80) path = 'steady';
  else if (st & 0x20) path = 'defeated';
  else {
    const s = st & 0x07;
    if (s === 0) path = 'steady';
    else if (s === 0x05) path = 'fall';
    else if (s >= 0x03) path = 'revive';
    else path = 'fall';
  }
  if (path === 'defeated') {
    MoveDefeatedEnemy(x);
    return;
  }
  if (path === 'revive') {
    ReviveStunned(x);
    return;
  }
  if (path === 'fall') {
    MoveD_EnemyVertically(x);
    y = 0;
    const s2 = ram[Enemy_State + x];
    if (s2 === 0x02) {
      MoveEnemyHorizontally(x);
      return;
    }
    if ((s2 & 0x40) && ram[Enemy_ID + x] !== PowerUpObject) y = 1;
  }
  // SteadM
  const spd = ram[Enemy_X_Speed + x];
  if (neg(spd)) y += 2;
  ram[Enemy_X_Speed + x] = add(spd, ROM[L.XSpeedAdderData + y]);
  MoveEnemyHorizontally(x);
  ram[Enemy_X_Speed + x] = spd;
}

function ReviveStunned(x) {
  const t = ram[EnemyIntervalTimer + x];
  if (t) {
    // ChkKillGoomba
    if (t === 0x0e && ram[Enemy_ID + x] === Goomba) EraseEnemyObject(x);
    return;
  }
  ram[Enemy_State + x] = 0;
  let y = ram[FrameCounter] & 0x01;
  ram[Enemy_MovingDir + x] = y + 1;
  if (ram[PrimaryHardMode]) y += 2;
  ram[Enemy_X_Speed + x] = ROM[L.RevivedXSpeed + y];
}

function MoveDefeatedEnemy(x) {
  MoveD_EnemyVertically(x);
  MoveEnemyHorizontally(x);
}

function MoveJumpingEnemy(x) {
  MoveJ_EnemyVertically(x);
  MoveEnemyHorizontally(x);
}

function ProcMoveRedPTroopa(x) {
  if (!(ram[Enemy_Y_Speed + x] | ram[Enemy_Y_MoveForce + x])) {
    ram[Enemy_YMF_Dummy + x] = 0;
    if (ram[Enemy_Y_Position + x] < ram[RedPTroopaOrigXPos + x]) {
      if (!(ram[FrameCounter] & 0x07)) ram[Enemy_Y_Position + x]++;
      return;
    }
  }
  if (ram[Enemy_Y_Position + x] < ram[RedPTroopaCenterYPos + x]) MoveRedPTroopaDown(x);
  else MoveRedPTroopaUp(x);
}

function MoveFlyGreenPTroopa(x) {
  XMoveCntr_Platform(x, 0x13);
  MoveWithXMCntrs(x);
  if (ram[FrameCounter] & 0x03) return;
  const y = (ram[FrameCounter] & 0x40) ? 0x01 : 0xff;
  ram[0x00] = y;
  ram[Enemy_Y_Position + x] = add(ram[Enemy_Y_Position + x], y);
}

function XMoveCntr_Platform(x, max) {
  ram[0x01] = max;
  if (ram[FrameCounter] & 0x03) return;
  const y = ram[XMoveSecondaryCounter + x];
  if (ram[XMovePrimaryCounter + x] & 1) {
    if (y === 0) ram[XMovePrimaryCounter + x]++;
    else ram[XMoveSecondaryCounter + x]--;
    return;
  }
  if (y === ram[0x01]) ram[XMovePrimaryCounter + x]++;
  else ram[XMoveSecondaryCounter + x]++;
}

function MoveWithXMCntrs(x) {
  const saved = ram[XMoveSecondaryCounter + x];
  let y = 0x01;
  if (!(ram[XMovePrimaryCounter + x] & 0x02)) {
    ram[XMoveSecondaryCounter + x] = twos(ram[XMoveSecondaryCounter + x]);
    y = 0x02;
  }
  ram[Enemy_MovingDir + x] = y;
  ram[0x00] = MoveEnemyHorizontally(x);
  ram[XMoveSecondaryCounter + x] = saved;
}

function MoveBloober(x) {
  if (ram[Enemy_State + x] & 0x20) {
    MoveEnemySlowVert(x);
    return;
  }
  if (!(ram[PseudoRandomBitReg + 1 + x] & ROM[L.BlooberBitmasks + ram[SecondaryHardMode]])) {
    let y;
    if (x & 1) {
      y = ram[Player_MovingDir];
    } else {
      y = 0x02;
      if (neg(PlayerEnemyDiff(x))) y--;
    }
    ram[Enemy_MovingDir + x] = y;
  }
  // BlooberSwim
  ProcSwimmingB(x);
  const a = sub(ram[Enemy_Y_Position + x], ram[Enemy_Y_MoveForce + x]);
  if (a >= 0x20) ram[Enemy_Y_Position + x] = a;
  if (ram[Enemy_MovingDir + x] === 1) {
    ram[Enemy_X_Position + x] = add(ram[Enemy_X_Position + x], ram[BlooperMoveSpeed + x]);
    ram[Enemy_PageLoc + x] = adc(ram[Enemy_PageLoc + x], 0x00);
  } else {
    ram[Enemy_X_Position + x] = sub(ram[Enemy_X_Position + x], ram[BlooperMoveSpeed + x]);
    ram[Enemy_PageLoc + x] = sbc(ram[Enemy_PageLoc + x], 0x00);
  }
}

function ProcSwimmingB(x) {
  if (ram[BlooperMoveCounter + x] & 0x02) {
    // ChkForFloatdown
    if (ram[EnemyIntervalTimer + x] === 0) {
      // ChkNearPlayer
      if (adc(ram[Enemy_Y_Position + x], 0x10) >= ram[Player_Y_Position]) {
        ram[BlooperMoveCounter + x] = 0;
        return;
      }
    }
    if (!(ram[FrameCounter] & 1)) ram[Enemy_Y_Position + x]++;
    return;
  }
  const f = ram[FrameCounter] & 0x07;
  if (ram[BlooperMoveCounter + x] & 0x01) {
    // SlowSwim
    if (f) return;
    const v = sub(ram[Enemy_Y_MoveForce + x], 0x01);
    ram[Enemy_Y_MoveForce + x] = v;
    ram[BlooperMoveSpeed + x] = v;
    if (v) return;
    ram[BlooperMoveCounter + x]++;
    ram[EnemyIntervalTimer + x] = 0x02;
    return;
  }
  if (f) return;
  const v = add(ram[Enemy_Y_MoveForce + x], 0x01);
  ram[Enemy_Y_MoveForce + x] = v;
  ram[BlooperMoveSpeed + x] = v;
  if (v !== 0x02) return;
  ram[BlooperMoveCounter + x]++;
}

function MoveBulletBill(x) {
  if (ram[Enemy_State + x] & 0x20) {
    MoveJ_EnemyVertically(x);
    return;
  }
  ram[Enemy_X_Speed + x] = 0xe8;
  MoveEnemyHorizontally(x);
}

function MoveSwimmingCheepCheep(x) {
  if (ram[Enemy_State + x] & 0x20) {
    MoveEnemySlowVert(x);
    return;
  }
  ram[0x03] = 0;
  ram[0x02] = ROM[L.SwimCCXMoveData + ram[Enemy_ID + x] - 0x0a];
  ram[Enemy_X_MoveForce + x] = sub(ram[Enemy_X_MoveForce + x], ram[0x02]);
  ram[Enemy_X_Position + x] = sbc(ram[Enemy_X_Position + x], 0x00);
  ram[Enemy_PageLoc + x] = sbc(ram[Enemy_PageLoc + x], 0x00);
  ram[0x02] = 0x20;
  if (x < 0x02) return;
  let hp;
  if (ram[CheepCheepMoveMFlag + x] >= 0x10) {
    ram[Enemy_YMF_Dummy + x] = add(ram[Enemy_YMF_Dummy + x], ram[0x02]);
    ram[Enemy_Y_Position + x] = adc(ram[Enemy_Y_Position + x], ram[0x03]);
    hp = adc(ram[Enemy_Y_HighPos + x], 0x00);
  } else {
    ram[Enemy_YMF_Dummy + x] = sub(ram[Enemy_YMF_Dummy + x], ram[0x02]);
    ram[Enemy_Y_Position + x] = sbc(ram[Enemy_Y_Position + x], ram[0x03]);
    hp = sbc(ram[Enemy_Y_HighPos + x], 0x00);
  }
  ram[Enemy_Y_HighPos + x] = hp;
  let y = 0;
  let d = sub(ram[Enemy_Y_Position + x], ram[CheepCheepOrigYPos + x]);
  if (neg(d)) {
    y = 0x10;
    d = twos(d);
  }
  if (d >= 0x0f) ram[CheepCheepMoveMFlag + x] = y;
}

// -------------------------------------------------------------------------------------

function ProcFirebar(x) {
  GetEnemyOffscreenBits(x);
  if (ram[Enemy_OffscreenBits] & 0x08) return;
  if (!ram[TimerControl]) {
    ram[FirebarSpinState_High + x] = FirebarSpin(x, ram[FirebarSpinSpeed + x]) & 0x1f;
  }
  let a = ram[FirebarSpinState_High + x];
  if (ram[Enemy_ID + x] >= 0x1f && (a === 0x08 || a === 0x18)) {
    a = (a + 1) & 0xff;
    ram[FirebarSpinState_High + x] = a;
  }
  ram[0xef] = a;
  RelativeEnemyPosition(x);
  let y = ram[Enemy_SprDataOffset + x];
  ram[Sprite_Y_Position + y] = ram[Enemy_Rel_YPos];
  ram[0x07] = ram[Enemy_Rel_YPos];
  ram[Sprite_X_Position + y] = ram[Enemy_Rel_XPos];
  ram[0x06] = ram[Enemy_Rel_XPos];
  ram[0x00] = 0x01;
  FirebarCollision(y);
  ram[0xed] = ram[Enemy_ID + x] >= 0x1f ? 0x0b : 0x05;
  ram[0x00] = 0;
  do {
    GetFirebarPosition(ram[0xef]);
    DrawFirebar_Collision();
    if (ram[0x00] === 0x04) {
      ram[0x06] = ram[Enemy_SprDataOffset + ram[DuplicateObj_Offset]];
    }
    ram[0x00]++;
  } while (ram[0x00] < ram[0xed]);
}

function DrawFirebar_Collision() {
  ram[0x05] = ram[0x03];
  const y = ram[0x06];
  let a = ram[0x01];
  ram[0x05] = lsr(ram[0x05]);
  if (!C) a = twos(a);
  a = add(a, ram[Enemy_Rel_XPos]);
  ram[Sprite_X_Position + y] = a;
  ram[0x06] = a;
  const rx = ram[Enemy_Rel_XPos];
  const d = a >= rx ? (a - rx) & 0xff : (rx - a) & 0xff;
  let v;
  if (d >= 0x59) {
    v = 0xf8;
  } else if (ram[Enemy_Rel_YPos] === 0xf8) {
    v = 0xf8;
  } else {
    v = ram[0x02];
    ram[0x05] = lsr(ram[0x05]);
    if (!C) v = twos(v);
    v = add(v, ram[Enemy_Rel_YPos]);
  }
  ram[Sprite_Y_Position + y] = v;
  ram[0x07] = v;
  FirebarCollision(y);
}

function FirebarCollision(y) {
  DrawFirebar(y);
  const savedY = y;
  if (!(ram[StarInvincibleTimer] | ram[TimerControl])) {
    ram[0x05] = 0;
    if (ram[Player_Y_HighPos] === 1) {
      let py = ram[Player_Y_Position];
      if (ram[PlayerSize] || ram[CrouchingFlag]) {
        ram[0x05] += 2;
        py = add(py, 0x18);
      }
      let a = py;
      for (;;) {
        let d = sub(a, ram[0x07]);
        if (neg(d)) d = twos(d);
        let hit = false;
        if (d < 0x08 && ram[0x06] < 0xf0) {
          ram[0x04] = add(ram[Sprite_X_Position + 4], 0x04);
          let dx = sub(ram[0x04], ram[0x06]);
          if (neg(dx)) dx = twos(dx);
          if (dx < 0x08) hit = true;
        }
        if (hit) {
          ram[Enemy_MovingDir] = ram[0x04] >= ram[0x06] ? 1 : 2;
          const s0 = ram[0x00];
          InjurePlayer();
          ram[0x00] = s0;
          break;
        }
        if (ram[0x05] === 0x02) break;
        a = add(ram[Player_Y_Position], ROM[L.FirebarYPos + ram[0x05]]);
        ram[0x05]++;
      }
    }
  }
  ram[0x06] = add(savedY, 0x04);
}

function GetFirebarPosition(s) {
  let a = s & 0x0f;
  if (a >= 0x09) a = ((a ^ 0x0f) + 1) & 0xff;
  ram[0x01] = a;
  let y = ram[0x00];
  ram[0x01] = ROM[L.FirebarPosLookupTbl + ((ROM[L.FirebarTblOffsets + y] + ram[0x01]) & 0xff)];
  a = (s + 0x08) & 0x0f;
  if (a >= 0x09) a = ((a ^ 0x0f) + 1) & 0xff;
  ram[0x02] = a;
  ram[0x02] = ROM[L.FirebarPosLookupTbl + ((ROM[L.FirebarTblOffsets + y] + ram[0x02]) & 0xff)];
  ram[0x03] = ROM[L.FirebarMirrorData + ((s >> 3) & 0x1f)];
}

function FirebarSpin(x, speed) {
  ram[0x07] = speed;
  if (ram[FirebarSpinDirection + x]) {
    ram[FirebarSpinState_Low + x] = sub(ram[FirebarSpinState_Low + x], ram[0x07]);
    return sbc(ram[FirebarSpinState_High + x], 0x00);
  }
  ram[FirebarSpinState_Low + x] = add(ram[FirebarSpinState_Low + x], ram[0x07]);
  return adc(ram[FirebarSpinState_High + x], 0x00);
}

function MoveFlyingCheepCheep(x) {
  if (ram[Enemy_State + x] & 0x20) {
    ram[Enemy_SprAttrib + x] = 0;
    MoveJ_EnemyVertically(x);
    return;
  }
  MoveEnemyHorizontally(x);
  SetXMoveAmt(x, 0x0d, 0x05);
  let y = ram[Enemy_Y_MoveForce + x] >> 4;
  let d = sub(ram[Enemy_Y_Position + x], ROM[L.PRandomSubtracter + y]);
  if (neg(d)) d = twos(d);
  if (d < 0x08) {
    const f = add(ram[Enemy_Y_MoveForce + x], 0x10);
    ram[Enemy_Y_MoveForce + x] = f;
    y = f >> 4;
  }
  ram[Enemy_SprAttrib + x] = ROM[L.FlyCCBPriority + y];
}

function MoveLakitu(x) {
  if (ram[Enemy_State + x] & 0x20) {
    MoveD_EnemyVertically(x);
    return;
  }
  let a;
  if (ram[Enemy_State + x]) {
    ram[LakituMoveDirection + x] = 0;
    ram[EnemyFrenzyBuffer] = 0;
    a = 0x10;
  } else {
    ram[EnemyFrenzyBuffer] = Spiny;
    for (let y = 2; y >= 0; y--) ram[0x01 + y] = ROM[L.LakituDiffAdj + y];
    a = PlayerLakituDiff(x);
  }
  ram[LakituMoveSpeed + x] = a;
  let y = 0x01;
  if (!(ram[LakituMoveDirection + x] & 0x01)) {
    ram[LakituMoveSpeed + x] = twos(ram[LakituMoveSpeed + x]);
    y++;
  }
  ram[Enemy_MovingDir + x] = y;
  MoveEnemyHorizontally(x);
}

function PlayerLakituDiff(x) {
  let y = 0;
  if (neg(PlayerEnemyDiff(x))) {
    y++;
    ram[0x00] = twos(ram[0x00]);
  }
  if (ram[0x00] >= 0x3c) {
    ram[0x00] = 0x3c;
    if (ram[Enemy_ID + x] === Lakitu && y !== ram[LakituMoveDirection + x]) {
      if (ram[LakituMoveDirection + x] !== 0) {
        ram[LakituMoveSpeed + x]--;
        if (ram[LakituMoveSpeed + x] !== 0) return ram[LakituMoveSpeed + x];
      }
      ram[LakituMoveDirection + x] = y;
    }
  }
  // ChkPSpeed
  ram[0x00] = (ram[0x00] & 0x3c) >> 2;
  y = 0;
  if (ram[Player_X_Speed] && ram[ScrollAmount]) {
    y++;
    if (ram[Player_X_Speed] >= 0x19 && ram[ScrollAmount] >= 0x02) y++;
    let keep = false;
    if (ram[Enemy_ID + x] === Spiny && ram[Player_X_Speed]) keep = true;
    if (!keep && !ram[Enemy_Y_Speed + x]) y = 0;
  }
  // SubDifAdj
  let a = ram[0x01 + y];
  for (let n = ram[0x00]; n >= 0; n--) a = sub(a, 0x01);
  return a;
}

// -------------------------------------------------------------------------------------

function BridgeCollapse() {
  const x = ram[BowserFront_Offset];
  if (ram[Enemy_ID + x] === Bowser) {
    ram[ObjectOffset] = x;
    const st = ram[Enemy_State + x];
    if (st === 0) {
      RemoveBridge(x);
      return;
    }
    if ((st & 0x40) && ram[Enemy_Y_Position + x] < 0xe0) {
      MoveEnemySlowVert(x);
      BowserGfxHandler(x);
      return;
    }
  }
  // SetM2
  ram[EventMusicQueue] = Silence;
  ram[OperMode_Task]++;
  KillAllEnemies();
}

function RemoveBridge(x) {
  if (decRam(BowserFeetCounter) === 0) {
    ram[BowserFeetCounter] = 0x04;
    ram[BowserBodyControls] ^= 0x01;
    ram[0x05] = 0x22;
    ram[0x04] = ROM[L.BridgeCollapseData + ram[BridgeCollapseOffset]];
    const y = (ram[VRAM_Buffer1_Offset] + 1) & 0xff;
    RemBridge(0x0c, y);
    MoveVOffset(y);
    ram[Square2SoundQueue] = Sfx_Blast;
    ram[NoiseSoundQueue] = Sfx_BrickShatter;
    ram[BridgeCollapseOffset]++;
    if (ram[BridgeCollapseOffset] === 0x0f) {
      InitVStf(x);
      ram[Enemy_State + x] = 0x40;
      ram[Square2SoundQueue] = Sfx_BowserFall;
    }
  }
  BowserGfxHandler(x);
}

function RunBowser(x) {
  if (!(ram[Enemy_State + x] & 0x20)) {
    BowserControl(x);
    return;
  }
  if (ram[Enemy_Y_Position + x] < 0xe0) {
    MoveEnemySlowVert(x);
    BowserGfxHandler(x);
    return;
  }
  KillAllEnemies();
}

function KillAllEnemies() {
  for (let x = 4; x >= 0; x--) EraseEnemyObject(x);
  ram[EnemyFrenzyBuffer] = 0;
}

function BowserControl(x) {
  ram[EnemyFrenzyBuffer] = 0;
  if (!ram[TimerControl]) {
    let hammerChk = false;
    if (neg(ram[BowserBodyControls])) {
      hammerChk = true;
    } else {
      if (decRam(BowserFeetCounter) === 0) {
        ram[BowserFeetCounter] = 0x20;
        ram[BowserBodyControls] ^= 0x01;
      }
      if (!(ram[FrameCounter] & 0x0f)) ram[Enemy_MovingDir + x] = 0x02;
      let getPR = true;
      if (ram[EnemyFrameTimer + x] && neg(PlayerEnemyDiff(x))) {
        ram[Enemy_MovingDir + x] = 0x01;
        ram[BowserMovementSpeed] = 0x02;
        ram[EnemyFrameTimer + x] = 0x20;
        ram[BowserFireBreathTimer] = 0x20;
        if (ram[Enemy_X_Position + x] >= 0xc8) {
          hammerChk = true;
          getPR = false;
        }
      }
      if (getPR && !hammerChk) {
        if (!(ram[FrameCounter] & 0x03)) {
          if (ram[Enemy_X_Position + x] === ram[BowserOrigXPos]) {
            ram[MaxRangeFromOrigin] = ROM[L.PRandomRange + (ram[PseudoRandomBitReg + x] & 0x03)];
          }
          ram[Enemy_X_Position + x] = add(ram[Enemy_X_Position + x], ram[BowserMovementSpeed]);
          if (ram[Enemy_MovingDir + x] !== 0x01) {
            let y = 0xff;
            let d = sub(ram[Enemy_X_Position + x], ram[BowserOrigXPos]);
            if (neg(d)) {
              d = twos(d);
              y = 0x01;
            }
            if (d >= ram[MaxRangeFromOrigin]) ram[BowserMovementSpeed] = y;
          }
        }
      }
    }
    // HammerChk
    const t = ram[EnemyFrameTimer + x];
    if (t === 0) {
      MoveEnemySlowVert(x);
      if (ram[WorldNumber] >= World6 && !(ram[FrameCounter] & 0x03)) SpawnHammerObj();
      if (ram[Enemy_Y_Position + x] >= 0x80) {
        ram[EnemyFrameTimer + x] = ROM[L.PRandomRange + (ram[PseudoRandomBitReg + x] & 0x03)];
      }
    } else if (t === 0x01) {
      ram[Enemy_Y_Position + x]--;
      InitVStf(x);
      ram[Enemy_Y_Speed + x] = 0xfe;
    }
  }
  // ChkFireB
  for (;;) {
    const w = ram[WorldNumber];
    if (w !== World8 && w >= World6) break;
    if (ram[BowserFireBreathTimer]) break;
    ram[BowserFireBreathTimer] = 0x20;
    ram[BowserBodyControls] ^= 0x80;
    if (neg(ram[BowserBodyControls])) continue;
    let a = SetFlameTimer();
    if (ram[SecondaryHardMode]) a = sub(a, 0x10);
    ram[BowserFireBreathTimer] = a;
    ram[EnemyFrenzyBuffer] = BowserFlame;
    break;
  }
  BowserGfxHandler(x);
}

function BowserGfxHandler(x) {
  ProcessBowserHalf(x);
  const off = (ram[Enemy_MovingDir + x] & 1) ? 0xf0 : 0x10;
  const y = ram[DuplicateObj_Offset];
  ram[Enemy_X_Position + y] = add(off, ram[Enemy_X_Position + x]);
  ram[Enemy_Y_Position + y] = add(ram[Enemy_Y_Position + x], 0x08);
  ram[Enemy_State + y] = ram[Enemy_State + x];
  ram[Enemy_MovingDir + y] = ram[Enemy_MovingDir + x];
  const saved = ram[ObjectOffset];
  ram[ObjectOffset] = y;
  ram[Enemy_ID + y] = Bowser;
  ProcessBowserHalf(y);
  ram[ObjectOffset] = saved;
  ram[BowserGfxFlag] = 0;
}

function ProcessBowserHalf(x) {
  ram[BowserGfxFlag]++;
  RunRetainerObj(x);
  if (ram[Enemy_State + x]) return;
  ram[Enemy_BoundBoxCtrl + x] = 0x0a;
  GetEnemyBoundBox(x);
  PlayerEnemyCollision(x);
}

function SetFlameTimer() {
  const y = ram[BowserFlameTimerCtrl];
  ram[BowserFlameTimerCtrl] = (y + 1) & 0x07;
  return ROM[L.FlameTimerData + y];
}

function ProcBowserFlame(x) {
  if (!ram[TimerControl]) {
    ram[0x00] = ram[SecondaryHardMode] ? 0x60 : 0x40;
    ram[Enemy_X_MoveForce + x] = sub(ram[Enemy_X_MoveForce + x], ram[0x00]);
    ram[Enemy_X_Position + x] = sbc(ram[Enemy_X_Position + x], 0x01);
    ram[Enemy_PageLoc + x] = sbc(ram[Enemy_PageLoc + x], 0x00);
    const y = ram[BowserFlamePRandomOfs + x];
    if (ram[Enemy_Y_Position + x] !== ROM[L.FlameYPosData + y]) {
      ram[Enemy_Y_Position + x] = add(ram[Enemy_Y_Position + x], ram[Enemy_Y_MoveForce + x]);
    }
  }
  // SetGfxF
  RelativeEnemyPosition(x);
  if (ram[Enemy_State + x]) return;
  ram[0x00] = 0x51;
  ram[0x01] = (ram[FrameCounter] & 0x02) ? 0x82 : 0x02;
  let y = ram[Enemy_SprDataOffset + x];
  for (let n = 0; n < 3; n++) {
    ram[Sprite_Y_Position + y] = ram[Enemy_Rel_YPos];
    ram[Sprite_Tilenumber + y] = ram[0x00];
    ram[0x00]++;
    ram[Sprite_Attributes + y] = ram[0x01];
    ram[Sprite_X_Position + y] = ram[Enemy_Rel_XPos];
    ram[Enemy_Rel_XPos] = add(ram[Enemy_Rel_XPos], 0x08);
    y += 4;
  }
  GetEnemyOffscreenBits(x);
  y = ram[Enemy_SprDataOffset + x];
  const bits = ram[Enemy_OffscreenBits];
  if (bits & 0x01) ram[Sprite_Y_Position + 12 + y] = 0xf8;
  if (bits & 0x02) ram[Sprite_Y_Position + 8 + y] = 0xf8;
  if (bits & 0x04) ram[Sprite_Y_Position + 4 + y] = 0xf8;
  if (bits & 0x08) ram[Sprite_Y_Position + y] = 0xf8;
}

function RunFireworks(x) {
  if (decRam(ExplosionTimerCounter + x) === 0) {
    ram[ExplosionTimerCounter + x] = 0x08;
    ram[ExplosionGfxCounter + x]++;
    if (ram[ExplosionGfxCounter + x] >= 0x03) {
      // FireworksSoundScore
      ram[Enemy_Flag + x] = 0;
      ram[Square2SoundQueue] = Sfx_Blast;
      ram[DigitModifier + 4] = 0x05;
      EndAreaPoints();
      return;
    }
  }
  RelativeEnemyPosition(x);
  ram[Fireball_Rel_YPos] = ram[Enemy_Rel_YPos];
  ram[Fireball_Rel_XPos] = ram[Enemy_Rel_XPos];
  DrawExplosion_Fireworks(ram[ExplosionGfxCounter + x], ram[Enemy_SprDataOffset + x]);
}

function RunStarFlagObj(x) {
  ram[EnemyFrenzyBuffer] = 0;
  const t = ram[StarFlagTaskControl];
  if (t >= 0x05) return;
  switch (t) {
    case 1: GameTimerFireworks(x); break;
    case 2: AwardGameTimerPoints(x); break;
    case 3: RaiseFlagSetoffFWorks(x); break;
    case 4: DelayToAreaEnd(x); break;
  }
}

function GameTimerFireworks(x) {
  let y = 0x05;
  let a = ram[GameTimerDisplay + 2];
  if (a !== 0x01) {
    y = 0x03;
    if (a !== 0x03) {
      y = 0x00;
      if (a !== 0x06) a = 0xff;
    }
  }
  ram[FireworksCounter] = a;
  ram[Enemy_State + x] = y;
  ram[StarFlagTaskControl]++;
}

function AwardGameTimerPoints() {
  if ((ram[GameTimerDisplay] | ram[GameTimerDisplay + 1] | ram[GameTimerDisplay + 2]) === 0) {
    ram[StarFlagTaskControl]++;
    return;
  }
  if (ram[FrameCounter] & 0x04) ram[Square2SoundQueue] = Sfx_TimerTick;
  ram[DigitModifier + 5] = 0xff;
  DigitsMathRoutine(0x23);
  ram[DigitModifier + 5] = 0x05;
  EndAreaPoints();
}

function EndAreaPoints() {
  DigitsMathRoutine(ram[CurrentPlayer] ? 0x11 : 0x0b);
  UpdateNumber(((ram[CurrentPlayer] << 4) | 0x04) & 0xff);
}

function RaiseFlagSetoffFWorks(x) {
  if (ram[Enemy_Y_Position + x] >= 0x72) {
    ram[Enemy_Y_Position + x]--;
    DrawStarFlag(x);
    return;
  }
  const fc = ram[FireworksCounter];
  if (fc === 0 || neg(fc)) {
    DrawStarFlag(x);
    ram[EnemyIntervalTimer + x] = 0x06;
    ram[StarFlagTaskControl]++;
    return;
  }
  ram[EnemyFrenzyBuffer] = Fireworks;
  DrawStarFlag(x);
}

function DrawStarFlag(x) {
  RelativeEnemyPosition(x);
  let y = ram[Enemy_SprDataOffset + x];
  for (let n = 3; n >= 0; n--) {
    ram[Sprite_Y_Position + y] = add(ram[Enemy_Rel_YPos], ROM[L.StarFlagYPosAdder + n]);
    ram[Sprite_Tilenumber + y] = ROM[L.StarFlagTileData + n];
    ram[Sprite_Attributes + y] = 0x22;
    ram[Sprite_X_Position + y] = add(ram[Enemy_Rel_XPos], ROM[L.StarFlagXPosAdder + n]);
    y += 4;
  }
}

function DelayToAreaEnd(x) {
  DrawStarFlag(x);
  if (ram[EnemyIntervalTimer + x]) return;
  if (ram[EventMusicBuffer]) return;
  ram[StarFlagTaskControl]++;
}

function MovePiranhaPlant(x) {
  if (!ram[Enemy_State + x] && !ram[EnemyFrameTimer + x]) {
    let move = false;
    if (ram[PiranhaPlant_MoveFlag + x]) {
      move = true;
    } else {
      let reverse = false;
      if (neg(ram[PiranhaPlant_Y_Speed + x])) {
        reverse = true;
      } else {
        if (neg(PlayerEnemyDiff(x))) ram[0x00] = twos(ram[0x00]);
        if (ram[0x00] >= 0x21) reverse = true;
      }
      if (reverse) {
        ram[PiranhaPlant_Y_Speed + x] = twos(ram[PiranhaPlant_Y_Speed + x]);
        ram[PiranhaPlant_MoveFlag + x]++;
        move = true;
      }
    }
    if (move) {
      let a = ram[PiranhaPlantDownYPos + x];
      if (neg(ram[PiranhaPlant_Y_Speed + x])) a = ram[PiranhaPlantUpYPos + x];
      ram[0x00] = a;
      if ((ram[FrameCounter] & 1) && !ram[TimerControl]) {
        const yp = add(ram[Enemy_Y_Position + x], ram[PiranhaPlant_Y_Speed + x]);
        ram[Enemy_Y_Position + x] = yp;
        if (yp === ram[0x00]) {
          ram[PiranhaPlant_MoveFlag + x] = 0;
          ram[EnemyFrameTimer + x] = 0x40;
        }
      }
    }
  }
  // PutinPipe
  ram[Enemy_SprAttrib + x] = 0x20;
}

// -------------------------------------------------------------------------------------

function BalancePlatform(x) {
  if (ram[Enemy_Y_HighPos + x] === 0x03) {
    EraseEnemyObject(x);
    return;
  }
  if (neg(ram[Enemy_State + x])) return;
  const y = ram[Enemy_State + x];
  ram[0x00] = ram[PlatformCollisionFlag + x];
  if (ram[Enemy_MovingDir + x]) {
    PlatformFall(x, y);
    return;
  }
  // ChkForFall
  if (0x2d >= ram[Enemy_Y_Position + x]) {
    if (y === ram[0x00]) {
      InitPlatformFall(x, y);
      return;
    }
    ram[Enemy_Y_Position + x] = 0x2d + 0x02;
    StopPlatforms(x, y);
    return;
  }
  if (0x2d >= ram[Enemy_Y_Position + y]) {
    if (x === ram[0x00]) {
      InitPlatformFall(x, y);
      return;
    }
    ram[Enemy_Y_Position + y] = 0x2d + 0x02;
    StopPlatforms(x, y);
    return;
  }
  // ChkToMoveBalPlat
  const oldY = ram[Enemy_Y_Position + x];
  const cf = ram[PlatformCollisionFlag + x];
  let action;
  if (!neg(cf)) {
    action = cf === ram[ObjectOffset] ? 'down' : 'up';
  } else {
    ram[0x00] = add(ram[Enemy_Y_MoveForce + x], 0x05);
    const s = adc(ram[Enemy_Y_Speed + x], 0x00);
    if (neg(s)) action = 'down';
    else if (s !== 0) action = 'up';
    else if (ram[0x00] < 0x0b) action = 'stop';
    else action = 'up';
  }
  if (action === 'up') MovePlatformUp(x);
  else if (action === 'stop') StopPlatforms(x, y);
  else MovePlatformDown(x);
  // DoOtherPlatform
  const oy = ram[Enemy_State + x];
  const diff = sub(oldY, ram[Enemy_Y_Position + x]);
  ram[Enemy_Y_Position + oy] = add(diff, ram[Enemy_Y_Position + oy]);
  if (!neg(ram[PlatformCollisionFlag + x])) PositionPlayerOnVPlat(ram[PlatformCollisionFlag + x]);
  DrawEraseRope();
}

function DrawEraseRope() {
  let y = ram[ObjectOffset];
  if (!(ram[Enemy_Y_Speed + y] | ram[Enemy_Y_MoveForce + y])) return;
  if (ram[VRAM_Buffer1_Offset] >= 0x20) return;
  const spd = ram[Enemy_Y_Speed + y];
  let x = SetupPlatformRope(spd, y);
  ram[VRAM_Buffer1 + x] = ram[0x01];
  ram[VRAM_Buffer1 + 1 + x] = ram[0x00];
  ram[VRAM_Buffer1 + 2 + x] = 0x02;
  if (neg(ram[Enemy_Y_Speed + y])) {
    ram[VRAM_Buffer1 + 3 + x] = 0x24;
    ram[VRAM_Buffer1 + 4 + x] = 0x24;
  } else {
    ram[VRAM_Buffer1 + 3 + x] = 0xa2;
    ram[VRAM_Buffer1 + 4 + x] = 0xa3;
  }
  y = ram[Enemy_State + y];
  x = SetupPlatformRope(spd ^ 0xff, y);
  ram[VRAM_Buffer1 + 5 + x] = ram[0x01];
  ram[VRAM_Buffer1 + 6 + x] = ram[0x00];
  ram[VRAM_Buffer1 + 7 + x] = 0x02;
  if (neg(spd)) {
    ram[VRAM_Buffer1 + 8 + x] = 0xa2;
    ram[VRAM_Buffer1 + 9 + x] = 0xa3;
  } else {
    ram[VRAM_Buffer1 + 8 + x] = 0x24;
    ram[VRAM_Buffer1 + 9 + x] = 0x24;
  }
  ram[VRAM_Buffer1 + 10 + x] = 0;
  ram[VRAM_Buffer1_Offset] = add(ram[VRAM_Buffer1_Offset], 10);
}

// returns X = VRAM_Buffer1_Offset; sets $00/$01 to the name table address
function SetupPlatformRope(speed, y) {
  let a = add(ram[Enemy_X_Position + y], 0x08);
  if (!ram[SecondaryHardMode]) a = add(a, 0x10);
  ram[0x02] = adc(ram[Enemy_PageLoc + y], 0x00);
  ram[0x00] = (a & 0xf0) >> 3;
  let v = ram[Enemy_Y_Position + y];
  if (neg(speed)) v = add(v, 0x08);
  ram[0x01] = ((v >> 6) | 0x20) | ((ram[0x02] & 1) << 2);
  ram[0x00] = add((v << 2) & 0xe0, ram[0x00]);
  if (ram[Enemy_Y_Position + y] >= 0xe8) ram[0x00] &= 0xbf;
  return ram[VRAM_Buffer1_Offset];
}

function InitPlatformFall(x, y) {
  GetEnemyOffscreenBits(y);
  x = ram[ObjectOffset];
  SetupFloateyNumber(x, 0x06);
  ram[FloateyNum_X_Pos + x] = ram[Player_Rel_XPos];
  ram[FloateyNum_Y_Pos + x] = ram[Player_Y_Position];
  ram[Enemy_MovingDir + x] = 0x01;
  StopPlatforms(x, y);
}

function StopPlatforms(x, y) {
  InitVStf(x);
  ram[Enemy_Y_Speed + y] = 0;
  ram[Enemy_Y_MoveForce + y] = 0;
}

function PlatformFall(x, y) {
  MoveFallingPlatform(x);
  MoveFallingPlatform(y);
  x = ram[ObjectOffset];
  const cf = ram[PlatformCollisionFlag + x];
  if (!neg(cf)) PositionPlayerOnVPlat(cf);
}

function YMovingPlatform(x) {
  let center = true;
  if (!(ram[Enemy_Y_Speed + x] | ram[Enemy_Y_MoveForce + x])) {
    ram[Enemy_YMF_Dummy + x] = 0;
    if (ram[Enemy_Y_Position + x] < ram[YPlatformTopYPos + x]) {
      if (!(ram[FrameCounter] & 0x07)) ram[Enemy_Y_Position + x]++;
      center = false;
    }
  }
  if (center) {
    if (ram[Enemy_Y_Position + x] < ram[YPlatformCenterYPos + x]) MovePlatformDown(x);
    else MovePlatformUp(x);
  }
  ChkYPCollision(x);
}

function ChkYPCollision(x) {
  if (!neg(ram[PlatformCollisionFlag + x])) PositionPlayerOnVPlat(x);
}

function XMovingPlatform(x) {
  XMoveCntr_Platform(x, 0x0e);
  MoveWithXMCntrs(x);
  if (!neg(ram[PlatformCollisionFlag + x])) PositionPlayerOnHPlat(x);
}

function PositionPlayerOnHPlat(x) {
  ram[Player_X_Position] = add(ram[Player_X_Position], ram[0x00]);
  let a = ram[Player_PageLoc];
  const y = ram[0x00];
  a = neg(y) ? sbc(a, 0x00) : adc(a, 0x00);
  ram[Player_PageLoc] = a;
  ram[Platform_X_Scroll] = y;
  PositionPlayerOnVPlat(x);
}

function DropPlatform(x) {
  if (neg(ram[PlatformCollisionFlag + x])) return;
  MoveDropPlatform(x);
  PositionPlayerOnVPlat(x);
}

function RightPlatform(x) {
  ram[0x00] = MoveEnemyHorizontally(x);
  if (neg(ram[PlatformCollisionFlag + x])) return;
  ram[Enemy_X_Speed + x] = 0x10;
  PositionPlayerOnHPlat(x);
}

function MoveLargeLiftPlat(x) {
  MoveLiftPlatforms(x);
  ChkYPCollision(x);
}

function MoveSmallPlatform(x) {
  MoveLiftPlatforms(x);
  ChkSmallPlatCollision(x);
}

function MoveLiftPlatforms(x) {
  if (ram[TimerControl]) return;
  ram[Enemy_YMF_Dummy + x] = add(ram[Enemy_YMF_Dummy + x], ram[Enemy_Y_MoveForce + x]);
  ram[Enemy_Y_Position + x] = adc(ram[Enemy_Y_Position + x], ram[Enemy_Y_Speed + x]);
}

function ChkSmallPlatCollision(x) {
  const f = ram[PlatformCollisionFlag + x];
  if (!f) return;
  PositionPlayerOnS_Plat(x, f);
}

// -------------------------------------------------------------------------------------

function OffscreenBoundsCheck(x) {
  const id = ram[Enemy_ID + x];
  if (id === FlyingCheepCheep) return;
  let a = ram[ScreenLeft_X_Pos];
  if (id === HammerBro || id === PiranhaPlant) {
    C = 1;
    a = adc(a, 0x38);
  } else {
    C = id >= PiranhaPlant ? 1 : 0;
  }
  a = sbc(a, 0x48);
  ram[0x01] = a;
  ram[0x00] = sbc(ram[ScreenLeft_PageLoc], 0x00);
  ram[0x03] = adc(ram[ScreenRight_X_Pos], 0x48);
  ram[0x02] = adc(ram[ScreenRight_PageLoc], 0x00);
  cmp(ram[Enemy_X_Position + x], ram[0x01]);
  if (neg(sbc(ram[Enemy_PageLoc + x], ram[0x00]))) {
    EraseEnemyObject(x);
    return;
  }
  cmp(ram[Enemy_X_Position + x], ram[0x03]);
  if (neg(sbc(ram[Enemy_PageLoc + x], ram[0x02]))) return;
  if (ram[Enemy_State + x] === HammerBro) return;
  if (id === PiranhaPlant || id === FlagpoleFlagObject || id === StarFlagObject || id === JumpspringObject) return;
  EraseEnemyObject(x);
}

function PlayerEnemyDiff(x) {
  ram[0x00] = sub(ram[Enemy_X_Position + x], ram[Player_X_Position]);
  return sbc(ram[Enemy_PageLoc + x], ram[Player_PageLoc]);
}
