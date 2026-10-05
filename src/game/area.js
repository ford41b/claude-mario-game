// Area (level) parser: decodes the original level object data column by
// column into the metatile buffer, block buffer and name tables.
// Port of AreaParserTaskHandler .. GetAreaDataAddrs.
'use strict';

const areaByte = (y) => ROM[(ptr(AreaData) + y) & 0xffff];
const enemyByte = (y) => ROM[(ptr(EnemyData) + y) & 0xffff];

function AreaParserTaskHandler() {
  let y = ram[AreaParserTaskNum];
  if (y === 0) {
    y = 8;
    ram[AreaParserTaskNum] = 8;
  }
  y--;
  switch (y) {
    case 0: case 4: IncrementColumnPos(); break;
    case 1: case 2: case 5: case 6: RenderAreaGraphics(); break;
    case 3: case 7: AreaParserCore(); break;
  }
  if (decRam(AreaParserTaskNum) === 0) RenderAttributeTables();
}

function IncrementColumnPos() {
  ram[CurrentColumnPos]++;
  if ((ram[CurrentColumnPos] & 0x0f) === 0) {
    ram[CurrentColumnPos] = 0;
    ram[CurrentPageLoc]++;
  }
  ram[BlockBufferColumnPos] = (ram[BlockBufferColumnPos] + 1) & 0x1f;
}

function AreaParserCore() {
  if (ram[BackloadingFlag]) ProcessAreaData();
  // RenderSceneryTerrain
  for (let x = 0; x <= 0x0c; x++) ram[MetatileBuffer + x] = 0;
  const bgs = ram[BackgroundScenery];
  if (bgs) {
    let a = ram[CurrentPageLoc];
    while (!neg((a - 3) & 0xff)) a = (a - 3) & 0xff;
    let x = ((a << 4) + ROM[L.BSceneDataOffsets - 1 + bgs] + ram[CurrentColumnPos]) & 0xff;
    const d = ROM[L.BackSceneryData + x];
    if (d) {
      x = ((d & 0x0f) - 1) * 3;
      let y = d >> 4;
      for (let n = 3; n > 0; n--) {
        ram[MetatileBuffer + y] = ROM[L.BackSceneryMetatiles + x];
        x++;
        y++;
        if (y === 0x0b) break;
      }
    }
  }
  // RendFore
  const fgs = ram[ForegroundScenery];
  if (fgs) {
    let y = ROM[L.FSceneDataOffsets - 1 + fgs];
    for (let x = 0; x < 0x0d; x++, y++) {
      const a = ROM[L.ForeSceneryData + y];
      if (a) ram[MetatileBuffer + x] = a;
    }
  }
  // RendTerr
  let tmt;
  if (ram[AreaType] === 0 && ram[WorldNumber] === World8) {
    tmt = 0x62;
  } else {
    tmt = ROM[L.TerrainMetatiles + ram[AreaType]];
    if (ram[CloudTypeOverride]) tmt = 0x88;
  }
  let x = 0;
  let ty = ram[TerrainControl] * 2;
  outer: for (;;) {
    let bits = ROM[L.TerrainRenderBits + ty];
    ty++;
    if (ram[CloudTypeOverride] && x !== 0) bits &= 0x08;
    for (let b = 0; b < 8; b++) {
      if (ROM[L.Bitmasks + b] & bits) ram[MetatileBuffer + x] = tmt;
      x++;
      if (x === 0x0d) break outer;
      if (ram[AreaType] === 0x02 && x === 0x0b) tmt = 0x54;
    }
  }
  // RendBBuf
  ProcessAreaData();
  GetBlockBufferAddr(ram[BlockBufferColumnPos]);
  const base = ptr(0x06);
  for (let r = 0; r < 0x0d; r++) {
    let mt = ram[MetatileBuffer + r];
    if (mt < ROM[L.BlockBuffLowBounds + (mt >> 6)]) mt = 0;
    ram[base + r * 16] = mt;
  }
}

function ProcessAreaData() {
  for (;;) {
    let x = 2;
    do {
      ram[ObjectOffset] = x;
      ram[BehindAreaParserFlag] = 0;
      let y = ram[AreaDataOffset];
      let action; // 'decode' | 'behind' | 'next'
      if (areaByte(y) === 0xfd || pos(ram[AreaObjectLength + x])) {
        action = 'decode';
      } else {
        if (areaByte(y + 1) & 0x80) {
          if (!ram[AreaObjectPageSel]) {
            ram[AreaObjectPageSel]++;
            ram[AreaObjectPageLoc]++;
          }
        }
        const row = areaByte(y) & 0x0f;
        action = null;
        if (row === 0x0d) {
          if (!(areaByte(y + 1) & 0x40) && !ram[AreaObjectPageSel]) {
            ram[AreaObjectPageLoc] = areaByte(y + 1) & 0x1f;
            ram[AreaObjectPageSel]++;
            action = 'next';
          }
        } else if (row === 0x0e) {
          if (ram[BackloadingFlag]) action = 'decode';
        }
        if (!action) {
          // CheckRear
          action = ram[AreaObjectPageLoc] < ram[CurrentPageLoc] ? 'behind' : 'decode';
        }
      }
      if (action === 'decode') {
        DecodeAreaData(x, ram[AreaDataOffset]);
      } else {
        if (action === 'behind') ram[BehindAreaParserFlag]++;
        IncAreaObjOffset();
      }
      // ChkLength
      x = ram[ObjectOffset];
      if (pos(ram[AreaObjectLength + x])) ram[AreaObjectLength + x]--;
      x--;
    } while (x >= 0);
    if (ram[BehindAreaParserFlag]) continue;
    if (ram[BackloadingFlag]) continue;
    return;
  }
}

function IncAreaObjOffset() {
  ram[AreaDataOffset] = (ram[AreaDataOffset] + 2) & 0xff;
  ram[AreaObjectPageSel] = 0;
}

function DecodeAreaData(x, y) {
  if (pos(ram[AreaObjectLength + x])) y = ram[AreaObjOffsetBuffer + x];
  const b0 = areaByte(y);
  if (b0 === 0xfd) return;
  let a = b0 & 0x0f;
  let adder = 0;
  if (a === 0x0f) adder = 0x10;
  else if (a === 0x0c) adder = 0x08;
  ram[0x07] = adder;
  x = ram[ObjectOffset];
  let id;
  if (a === 0x0e) {
    ram[0x07] = 0;
    id = 0x2e;
  } else if (a === 0x0d) {
    ram[0x07] = 0x22;
    y++;
    const b1 = areaByte(y);
    if (!(b1 & 0x40)) return; // page control handled earlier
    let v = b1 & 0x7f;
    if (v === 0x4b) ram[LoopCommand]++;
    id = v & 0x3f;
  } else if (a >= 0x0c) {
    // SpecObj (rows 12 and 15)
    y++;
    id = (areaByte(y) & 0x70) >> 4;
  } else {
    y++;
    const b1 = areaByte(y);
    const big = b1 & 0x70;
    if (big) {
      let v = big;
      if (v === 0x70 && (b1 & 0x08)) v = 0; // warp pipe
      id = v >> 4;
    } else {
      ram[0x07] = 0x16;
      id = b1 & 0x0f;
    }
  }
  // NormObj
  ram[0x00] = id;
  if (neg(ram[AreaObjectLength + x])) {
    if (ram[AreaObjectPageLoc] === ram[CurrentPageLoc]) {
      // InitRear
      if (ram[BackloadingFlag]) {
        ram[BackloadingFlag] = 0;
        ram[BehindAreaParserFlag] = 0;
        ram[ObjectOffset] = 0;
        return;
      }
      // BackColC
      const col = areaByte(ram[AreaDataOffset]) >> 4;
      if (col !== ram[CurrentColumnPos]) return;
    } else {
      const row = areaByte(ram[AreaDataOffset]) & 0x0f;
      if (row !== 0x0e) return;
      if (!ram[BackloadingFlag]) return;
    }
    // StrAObj
    ram[AreaObjOffsetBuffer + x] = ram[AreaDataOffset];
    IncAreaObjOffset();
  }
  // RunAObj
  const fn = AreaObjectHandlers[(ram[0x00] + ram[0x07]) & 0xff];
  if (fn) fn(x);
}

// -------------------------------------------------------------------------------------

function AlterAreaAttributes(x) {
  const y = ram[AreaObjOffsetBuffer + x] + 1;
  const b = areaByte(y);
  if (!(b & 0x40)) {
    ram[TerrainControl] = b & 0x0f;
    ram[BackgroundScenery] = (b & 0x30) >> 4;
    return;
  }
  let a = b & 0x07;
  if (a >= 0x04) {
    ram[BackgroundColorCtrl] = a;
    a = 0;
  }
  ram[ForegroundScenery] = a;
}

function ScrollLockObject_Warp(x) {
  let n = 0x04;
  if (ram[WorldNumber] !== 0) {
    n++;
    if (ram[AreaType] === 1) n++;
  }
  ram[WarpZoneControl] = n;
  WriteGameText(n);
  KillEnemies(PiranhaPlant);
  ScrollLockObject(x);
}

function ScrollLockObject() {
  ram[ScrollLock] ^= 0x01;
}

function KillEnemies(id) {
  for (let x = 4; x >= 0; x--) {
    if (ram[Enemy_ID + x] === id) ram[Enemy_Flag + x] = 0;
  }
}

function AreaFrenzy() {
  let a = ROM[L.FrenzyIDData - 8 + ram[0x00]];
  for (let y = 4; y >= 0; y--) {
    if (a === ram[Enemy_ID + y]) {
      a = 0;
      break;
    }
  }
  ram[EnemyFrenzyQueue] = a;
}

function AreaStyleObject(x) {
  switch (ram[AreaStyle]) {
    case 0: TreeLedge(x); break;
    case 1: MushroomLedge(x); break;
    case 2: BulletBillCannon(x); break;
  }
}

function TreeLedge(x) {
  const y = GetLrgObjAttrib(x);
  const len = ram[AreaObjectLength + x];
  if (len === 0) {
    NoUnder(0x18);
    return;
  }
  if (neg(len)) {
    ram[AreaObjectLength + x] = y;
    if ((ram[CurrentPageLoc] | ram[CurrentColumnPos]) !== 0) {
      NoUnder(0x16);
      return;
    }
  }
  // MidTreeL
  const r = ram[0x07];
  ram[MetatileBuffer + r] = 0x17;
  AllUnder(0x4c, r);
}

function MushroomLedge(x) {
  const y = ChkLrgObjLength(x);
  ram[0x06] = y;
  if (C) {
    ram[MushroomLedgeHalfLen + x] = ram[AreaObjectLength + x] >> 1;
    NoUnder(0x19);
    return;
  }
  // EndMushL
  const len = ram[AreaObjectLength + x];
  if (len === 0) {
    NoUnder(0x1b);
    return;
  }
  ram[0x06] = ram[MushroomLedgeHalfLen + x];
  let r = ram[0x07];
  ram[MetatileBuffer + r] = 0x1a;
  if (len !== ram[0x06]) return;
  r++;
  ram[MetatileBuffer + r] = 0x4f;
  AllUnder(0x50, r);
}

function AllUnder(a, x) {
  RenderUnderPart(a, x + 1, 0x0f);
}
function NoUnder(a) {
  RenderUnderPart(a, ram[0x07], 0x00);
}

function PulleyRopeObject(x) {
  ChkLrgObjLength(x);
  let y = 0;
  if (!C) {
    y = 1;
    if (ram[AreaObjectLength + x] === 0) y = 2;
  }
  ram[MetatileBuffer] = ROM[L.PulleyRopeMetatiles + y];
}

function CastleObject(x) {
  const y0 = GetLrgObjAttrib(x);
  ram[0x07] = y0;
  ChkLrgObjFixedLength(x, 0x04);
  let y = ram[AreaObjectLength + x];
  let r = ram[0x07];
  ram[0x06] = 0x0b;
  do {
    ram[MetatileBuffer + r] = ROM[L.CastleMetatiles + y];
    r++;
    if (ram[0x06] !== 0) {
      y += 5;
      ram[0x06]--;
    }
  } while (r !== 0x0b && r < 0x0d);
  if (ram[CurrentPageLoc] === 0) return;
  const len = ram[AreaObjectLength + x];
  if (len === 0x01 || (ram[0x07] === 0 && len === 0x03)) {
    ram[MetatileBuffer + 10] = 0x52; // PlayerStop
    return;
  }
  if (len !== 0x02) return;
  const px = GetAreaObjXPosition();
  const e = FindEmptyEnemySlot();
  ram[Enemy_X_Position + e] = px;
  ram[Enemy_PageLoc + e] = ram[CurrentPageLoc];
  ram[Enemy_Y_HighPos + e] = 0x01;
  ram[Enemy_Flag + e] = 0x01;
  ram[Enemy_Y_Position + e] = 0x90;
  ram[Enemy_ID + e] = StarFlagObject;
}

function WaterPipe(x) {
  GetLrgObjAttrib(x);
  const r = ram[0x07];
  ram[MetatileBuffer + r] = 0x6b;
  ram[MetatileBuffer + r + 1] = 0x6c;
}

function IntroPipe(x) {
  ChkLrgObjFixedLength(x, 0x03);
  const y = RenderSidewaysPipe(x, 0x0a);
  if (C) return;
  for (let r = 6; r >= 0; r--) ram[MetatileBuffer + r] = 0;
  ram[MetatileBuffer + 7] = ROM[L.VerticalPipeData + y];
}

function ExitPipe(x) {
  ChkLrgObjFixedLength(x, 0x03);
  const y = GetLrgObjAttrib(x);
  RenderSidewaysPipe(x, y);
}

// returns Y ($06 = horizontal length left); carry clear if the vertical shaft was drawn
function RenderSidewaysPipe(x, y) {
  y = (y - 2) & 0xff;
  ram[0x05] = y;
  const left = ram[AreaObjectLength + x];
  ram[0x06] = left;
  let r = (ram[0x05] + 1) & 0xff;
  const shaft = ROM[L.SidePipeShaftData + left];
  C = 1; // CMP #$00 sets carry
  if (shaft !== 0) {
    r = RenderUnderPart(shaft, 0, ram[0x05]);
    C = 0;
  }
  const c = C;
  ram[MetatileBuffer + r] = ROM[L.SidePipeTopPart + ram[0x06]];
  ram[MetatileBuffer + r + 1] = ROM[L.SidePipeBottomPart + ram[0x06]];
  C = c;
  return ram[0x06];
}

function VerticalPipe(x) {
  let y = GetPipeHeight(x);
  if (ram[0x00] !== 0) y += 4;
  const saveY = y;
  if ((ram[AreaNumber] | ram[WorldNumber]) !== 0 && ram[AreaObjectLength + x] !== 0) {
    const e = FindEmptyEnemySlot();
    if (!C) {
      C = 0;
      ram[Enemy_X_Position + e] = adc(GetAreaObjXPosition(), 0x08);
      ram[Enemy_PageLoc + e] = adc(ram[CurrentPageLoc], 0x00);
      ram[Enemy_Y_HighPos + e] = 0x01;
      ram[Enemy_Flag + e] = 0x01;
      ram[Enemy_Y_Position + e] = GetAreaObjYPosition();
      ram[Enemy_ID + e] = PiranhaPlant;
      InitPiranhaPlant(e);
    }
  }
  // DrawPipe
  y = saveY;
  let r = ram[0x07];
  ram[MetatileBuffer + r] = ROM[L.VerticalPipeData + y];
  r++;
  RenderUnderPart(ROM[L.VerticalPipeData + y + 2], r, (ram[0x06] - 1) & 0xff);
}

function GetPipeHeight(x) {
  ChkLrgObjFixedLength(x, 0x01);
  const y = GetLrgObjAttrib(x);
  ram[0x06] = y & 0x07;
  return ram[AreaObjectLength + x];
}

// returns X = slot (0-4, or 5 if none free) and sets carry if none found
function FindEmptyEnemySlot() {
  let x = 0;
  for (;;) {
    C = 0;
    if (ram[Enemy_Flag + x] === 0) return x;
    x++;
    if (x === 5) {
      C = 1;
      return x;
    }
  }
}

function Hole_Water(x) {
  ChkLrgObjLength(x);
  ram[MetatileBuffer + 10] = 0x86;
  RenderUnderPart(0x87, 0x0b, 0x01);
}

function QuestionBlockRow_High(x) {
  QuestionBlockRow(x, 0x03);
}
function QuestionBlockRow_Low(x) {
  QuestionBlockRow(x, 0x07);
}
function QuestionBlockRow(x, row) {
  ChkLrgObjLength(x);
  ram[MetatileBuffer + row] = 0xc0;
}

function Bridge_High(x) { Bridge(x, 0x06); }
function Bridge_Middle(x) { Bridge(x, 0x07); }
function Bridge_Low(x) { Bridge(x, 0x09); }
function Bridge(x, row) {
  ChkLrgObjLength(x);
  ram[MetatileBuffer + row] = 0x0b;
  RenderUnderPart(0x63, row + 1, 0x00);
}

function FlagBalls_Residual(x) {
  const y = GetLrgObjAttrib(x);
  RenderUnderPart(0x6d, 0x02, y);
}

function FlagpoleObject() {
  ram[MetatileBuffer] = 0x24;
  RenderUnderPart(0x25, 0x01, 0x08);
  ram[MetatileBuffer + 10] = 0x61;
  C = 1;
  ram[Enemy_X_Position + 5] = sbc(GetAreaObjXPosition(), 0x08);
  ram[Enemy_PageLoc + 5] = sbc(ram[CurrentPageLoc], 0x00);
  ram[Enemy_Y_Position + 5] = 0x30;
  ram[FlagpoleFNum_Y_Pos] = 0xb0;
  ram[Enemy_ID + 5] = FlagpoleFlagObject;
  ram[Enemy_Flag + 5]++;
}

function EndlessRope() {
  RenderUnderPart(0x40, 0x00, 0x0f);
}

function BalancePlatRope(x) {
  RenderUnderPart(0x44, 0x01, 0x0f);
  const y = GetLrgObjAttrib(x);
  RenderUnderPart(0x40, 0x01, y);
}

function RowOfCoins(x) {
  GetRow(x, ROM[L.CoinMetatileData + ram[AreaType]]);
}

function CastleBridgeObj(x) {
  ChkLrgObjFixedLength(x, 0x0c);
  ChainObj(x);
}

function AxeObj(x) {
  ram[VRAM_Buffer_AddrCtrl] = 0x08;
  ChainObj(x);
}

function ChainObj() {
  const y = ram[0x00];
  const r = ROM[L.C_ObjectRow - 2 + y];
  RenderUnderPart(ROM[L.C_ObjectMetatile - 2 + y], r, 0x00);
}

function EmptyBlock(x) {
  GetLrgObjAttrib(x);
  RenderUnderPart(0xc4, ram[0x07], 0x00);
}

function RowOfBricks(x) {
  let y = ram[AreaType];
  if (ram[CloudTypeOverride]) y = 0x04;
  GetRow(x, ROM[L.BrickMetatiles + y]);
}

function RowOfSolidBlocks(x) {
  GetRow(x, ROM[L.SolidBlockMetatiles + ram[AreaType]]);
}

function GetRow(x, mt) {
  ChkLrgObjLength(x);
  DrawRow(mt);
}
function DrawRow(mt) {
  RenderUnderPart(mt, ram[0x07], 0x00);
}

function ColumnOfBricks(x) {
  GetRow2(x, ROM[L.BrickMetatiles + ram[AreaType]]);
}
function ColumnOfSolidBlocks(x) {
  GetRow2(x, ROM[L.SolidBlockMetatiles + ram[AreaType]]);
}
function GetRow2(x, mt) {
  const y = GetLrgObjAttrib(x);
  RenderUnderPart(mt, ram[0x07], y);
}

function BulletBillCannon(x) {
  let y = GetLrgObjAttrib(x);
  let r = ram[0x07];
  ram[MetatileBuffer + r] = 0x64;
  r++;
  y = (y - 1) & 0xff;
  if (!neg(y)) {
    ram[MetatileBuffer + r] = 0x65;
    r++;
    y = (y - 1) & 0xff;
    if (!neg(y)) RenderUnderPart(0x66, r, y);
  }
  // SetupCannon
  let c = ram[Cannon_Offset];
  ram[Cannon_Y_Position + c] = GetAreaObjYPosition();
  ram[Cannon_PageLoc + c] = ram[CurrentPageLoc];
  ram[Cannon_X_Position + c] = GetAreaObjXPosition();
  c++;
  if (c >= 0x06) c = 0;
  ram[Cannon_Offset] = c;
}

function StaircaseObject(x) {
  ChkLrgObjLength(x);
  if (C) ram[StaircaseControl] = 0x09;
  ram[StaircaseControl]--;
  const y = ram[StaircaseControl];
  RenderUnderPart(0x61, ROM[L.StaircaseRowData + y], ROM[L.StaircaseHeightData + y]);
}

function Jumpspring(x) {
  GetLrgObjAttrib(x);
  const e = FindEmptyEnemySlot();
  ram[Enemy_X_Position + e] = GetAreaObjXPosition();
  ram[Enemy_PageLoc + e] = ram[CurrentPageLoc];
  const yp = GetAreaObjYPosition();
  ram[Enemy_Y_Position + e] = yp;
  ram[Jumpspring_FixedYPos + e] = yp;
  ram[Enemy_ID + e] = JumpspringObject;
  ram[Enemy_Y_HighPos + e] = 0x01;
  ram[Enemy_Flag + e]++;
  const r = ram[0x07];
  ram[MetatileBuffer + r] = 0x67;
  ram[MetatileBuffer + r + 1] = 0x68;
}

function Hidden1UpBlock(x) {
  if (!ram[Hidden1UpFlag]) return;
  ram[Hidden1UpFlag] = 0;
  BrickWithItem(x);
}

function QuestionBlock(x) {
  const y = GetAreaObjectID();
  DrawQBlk(x, y);
}

function BrickWithCoins(x) {
  ram[BrickCoinTimerFlag] = 0;
  BrickWithItem(x);
}

function BrickWithItem(x) {
  const id = GetAreaObjectID();
  ram[0x07] = id;
  const adder = ram[AreaType] === 1 ? 0 : 5;
  DrawQBlk(x, (adder + ram[0x07]) & 0xff);
}

function DrawQBlk(x, y) {
  const mt = ROM[L.BrickQBlockMetatiles + y];
  GetLrgObjAttrib(x);
  DrawRow(mt);
}

function GetAreaObjectID() {
  return ram[0x00];
}

function Hole_Empty(x) {
  const y = ChkLrgObjLength(x);
  if (C && ram[AreaType] === 0) {
    let w = ram[Whirlpool_Offset];
    C = 1;
    ram[Whirlpool_LeftExtent + w] = sbc(GetAreaObjXPosition(), 0x10);
    ram[Whirlpool_PageLoc + w] = sbc(ram[CurrentPageLoc], 0x00);
    ram[Whirlpool_Length + w] = ((y + 2) << 4) & 0xff;
    w++;
    if (w >= 0x05) w = 0;
    ram[Whirlpool_Offset] = w;
  }
  RenderUnderPart(ROM[L.HoleMetatiles + ram[AreaType]], 0x08, 0x0f);
}

// Draws metatile `a` from row x downward for (y+1) rows, respecting what is
// already in the buffer. Returns the row index where it stopped.
function RenderUnderPart(a, x, y) {
  for (;;) {
    ram[AreaObjectHeight] = y;
    const cur = ram[MetatileBuffer + x];
    let draw;
    if (cur === 0) draw = true;
    else if (cur === 0x17 || cur === 0x1a) draw = false;
    else if (cur === 0xc0) draw = true;
    else if (cur >= 0xc0) draw = false;
    else if (cur !== 0x54) draw = true;
    else draw = a !== 0x50;
    if (draw) ram[MetatileBuffer + x] = a;
    x++;
    if (x >= 0x0d) return x;
    y = (ram[AreaObjectHeight] - 1) & 0xff;
    if (neg(y)) return x;
  }
}

// returns Y (length) and sets carry if the object is just starting
function ChkLrgObjLength(x) {
  const y = GetLrgObjAttrib(x);
  ChkLrgObjFixedLength(x, y);
  return y;
}

function ChkLrgObjFixedLength(x, y) {
  if (pos(ram[AreaObjectLength + x])) {
    C = 0;
    return y;
  }
  ram[AreaObjectLength + x] = y;
  C = 1;
  return y;
}

// sets $07 = row from first byte, returns low nybble of second byte
function GetLrgObjAttrib(x) {
  const y = ram[AreaObjOffsetBuffer + x];
  ram[0x07] = areaByte(y) & 0x0f;
  return areaByte(y + 1) & 0x0f;
}

function GetAreaObjXPosition() {
  return (ram[CurrentColumnPos] << 4) & 0xff;
}

function GetAreaObjYPosition() {
  C = 0;
  return adc((ram[0x07] << 4) & 0xff, 32);
}

function GetBlockBufferAddr(a) {
  const y = a >> 4;
  ram[0x07] = ROM[L.BlockBufferAddr + 2 + y];
  ram[0x06] = ((a & 0x0f) + ROM[L.BlockBufferAddr + y]) & 0xff;
}

// -------------------------------------------------------------------------------------

function LoadAreaPointer() {
  const a = FindAreaPointer();
  ram[AreaPointer] = a;
  return GetAreaType(a);
}

function GetAreaType(a) {
  const t = (a & 0x60) >> 5;
  ram[AreaType] = t;
  return t;
}

function FindAreaPointer() {
  const y = (ROM[L.WorldAddrOffsets + ram[WorldNumber]] + ram[AreaNumber]) & 0xff;
  return ROM[L.AreaAddrOffsets + y];
}

function GetAreaDataAddrs() {
  const type = GetAreaType(ram[AreaPointer]);
  const lo = ram[AreaPointer] & 0x1f;
  ram[AreaAddrsLOffset] = lo;
  let y = (ROM[L.EnemyAddrHOffsets + type] + lo) & 0xff;
  ram[EnemyDataLow] = ROM[L.EnemyDataAddrLow + y];
  ram[EnemyDataHigh] = ROM[L.EnemyDataAddrHigh + y];
  y = (ROM[L.AreaDataHOffsets + ram[AreaType]] + lo) & 0xff;
  ram[AreaDataLow] = ROM[L.AreaDataAddrLow + y];
  ram[AreaDataHigh] = ROM[L.AreaDataAddrHigh + y];
  const h0 = areaByte(0);
  let a = h0 & 0x07;
  if (a >= 0x04) {
    ram[BackgroundColorCtrl] = a;
    a = 0;
  }
  ram[ForegroundScenery] = a;
  ram[PlayerEntranceCtrl] = (h0 & 0x38) >> 3;
  ram[GameTimerSetting] = (h0 & 0xc0) >> 6;
  const h1 = areaByte(1);
  ram[TerrainControl] = h1 & 0x0f;
  ram[BackgroundScenery] = (h1 & 0x30) >> 4;
  let style = (h1 & 0xc0) >> 6;
  if (style === 0x03) {
    ram[CloudTypeOverride] = style;
    style = 0;
  }
  ram[AreaStyle] = style;
  const p = (ptr(AreaData) + 2) & 0xffff;
  ram[AreaDataLow] = p & 0xff;
  ram[AreaDataHigh] = p >> 8;
}

// handler table indexed by object id + row adder
const AreaObjectHandlers = [
  // large objects (rows $00-$0b)
  VerticalPipe, AreaStyleObject, RowOfBricks, RowOfSolidBlocks,
  RowOfCoins, ColumnOfBricks, ColumnOfSolidBlocks, VerticalPipe,
  // row $0c
  Hole_Empty, PulleyRopeObject, Bridge_High, Bridge_Middle,
  Bridge_Low, Hole_Water, QuestionBlockRow_High, QuestionBlockRow_Low,
  // row $0f
  EndlessRope, BalancePlatRope, CastleObject, StaircaseObject,
  ExitPipe, FlagBalls_Residual,
  // small objects
  QuestionBlock, QuestionBlock, QuestionBlock, Hidden1UpBlock,
  BrickWithItem, BrickWithItem, BrickWithItem, BrickWithCoins,
  BrickWithItem, WaterPipe, EmptyBlock, Jumpspring,
  // row $0d
  IntroPipe, FlagpoleObject, AxeObj, ChainObj,
  CastleBridgeObj, ScrollLockObject_Warp, ScrollLockObject, ScrollLockObject,
  AreaFrenzy, AreaFrenzy, AreaFrenzy, () => {},
  // row $0e
  AlterAreaAttributes,
];
