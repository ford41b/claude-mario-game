// Game engine core: per-frame object processing, scrolling, the player's
// state machine and physics, timers, flagpole, vines, cannons, hammers,
// coins, power-ups and block objects. Port of GameMode .. BlockObjMT_Updater
// and the shared movement routines.
'use strict';

function GameMode() {
  switch (ram[OperMode_Task]) {
    case 0: InitializeArea(); break;
    case 1: ScreenRoutines(); break;
    case 2: SecondaryGameSetup(); break;
    case 3: GameCoreRoutine(); break;
  }
}

function GameCoreRoutine() {
  ram[SavedJoypadBits] = ram[SavedJoypadBits + ram[CurrentPlayer]];
  GameRoutines();
  if (ram[OperMode_Task] >= 0x03) GameEngine();
}

function GameEngine() {
  ProcFireball_Bubble();
  for (let x = 0; x < 6; x++) {
    ram[ObjectOffset] = x;
    EnemiesAndLoopsCore(x);
    FloateyNumbersRoutine(x);
  }
  GetPlayerOffscreenBits();
  RelativePlayerPosition();
  PlayerGfxHandler();
  BlockObjMT_Updater();
  ram[ObjectOffset] = 1;
  BlockObjectsCore(1);
  ram[ObjectOffset] = 0;
  BlockObjectsCore(0);
  MiscObjectsCore();
  ProcessCannons();
  ProcessWhirlpools();
  FlagpoleRoutine();
  RunGameTimer();
  ColorRotation();
  if (neg((ram[Player_Y_HighPos] - 2) & 0xff)) {
    const st = ram[StarInvincibleTimer];
    if (st === 0) {
      ResetPalStar();
      SaveAB();
      return;
    }
    if (st === 0x04 && ram[IntervalTimerControl] === 0) GetAreaMusic();
  }
  // NoChgMus
  let a = ram[FrameCounter];
  if (ram[StarInvincibleTimer] < 0x08) a >>= 2;
  CyclePlayerPalette(a >> 1);
  SaveAB();
}

function SaveAB() {
  ram[PreviousA_B_Buttons] = ram[A_B_Buttons];
  ram[Left_Right_Buttons] = 0;
  UpdScrollVar();
}

function UpdScrollVar() {
  if (ram[VRAM_Buffer_AddrCtrl] === 0x06) return;
  if (ram[AreaParserTaskNum] === 0) {
    if (neg((ram[ScrollThirtyTwo] - 0x20) & 0xff)) return;
    ram[ScrollThirtyTwo] = (ram[ScrollThirtyTwo] - 0x20) & 0xff;
    ram[VRAM_Buffer2_Offset] = 0;
  }
  AreaParserTaskHandler();
}

// -------------------------------------------------------------------------------------

function ScrollHandler() {
  ram[Player_X_Scroll] = add(ram[Player_X_Scroll], ram[Platform_X_Scroll]);
  if (ram[ScrollLock] || ram[Player_Pos_ForScroll] < 0x50 || ram[SideCollisionTimer]) {
    InitScrlAmt();
    return;
  }
  let y = (ram[Player_X_Scroll] - 1) & 0xff;
  if (neg(y)) {
    InitScrlAmt();
    return;
  }
  y = (y + 1) & 0xff;
  if (y >= 0x02) y--;
  if (ram[Player_Pos_ForScroll] >= 0x70) y = ram[Player_X_Scroll];
  ScrollScreen(y);
}

function ScrollScreen(y) {
  ram[ScrollAmount] = y;
  ram[ScrollThirtyTwo] = add(y, ram[ScrollThirtyTwo]);
  const lx = add(y, ram[ScreenLeft_X_Pos]);
  ram[ScreenLeft_X_Pos] = lx;
  ram[HorizontalScroll] = lx;
  ram[ScreenLeft_PageLoc] = adc(ram[ScreenLeft_PageLoc], 0);
  ram[Mirror_PPU_CTRL_REG1] = (ram[Mirror_PPU_CTRL_REG1] & 0xfe) | (ram[ScreenLeft_PageLoc] & 1);
  GetScreenPosition();
  ram[ScrollIntervalTimer] = 0x08;
  ChkPOffscr();
}

function InitScrlAmt() {
  ram[ScrollAmount] = 0;
  ChkPOffscr();
}

function ChkPOffscr() {
  const bits = GetXOffscreenBits(0);
  ram[0x00] = bits;
  let y = 0;
  let keep = false;
  if (bits & 0x80) keep = true;
  else {
    y = 1;
    if (bits & 0x20) keep = true;
  }
  if (keep) {
    ram[Player_X_Position] = sub(ram[ScreenEdge_X_Pos + y], ROM[L.X_SubtracterData + y]);
    ram[Player_PageLoc] = sbc(ram[ScreenEdge_PageLoc + y], 0);
    if (ram[Left_Right_Buttons] !== ROM[L.OffscrJoypadBitsData + y]) ram[Player_X_Speed] = 0;
  }
  ram[Platform_X_Scroll] = 0;
}

function GetScreenPosition() {
  ram[ScreenRight_X_Pos] = add(ram[ScreenLeft_X_Pos], 0xff);
  ram[ScreenRight_PageLoc] = adc(ram[ScreenLeft_PageLoc], 0);
  return ram[ScreenRight_PageLoc];
}

// -------------------------------------------------------------------------------------

function GameRoutines() {
  switch (ram[GameEngineSubroutine]) {
    case 0x00: Entrance_GameTimerSetup(); break;
    case 0x01: Vine_AutoClimb(); break;
    case 0x02: SideExitPipeEntry(); break;
    case 0x03: VerticalPipeEntry(); break;
    case 0x04: FlagpoleSlide(); break;
    case 0x05: PlayerEndLevel(); break;
    case 0x06: PlayerLoseLife(); break;
    case 0x07: PlayerEntrance(); break;
    case 0x08: PlayerCtrlRoutine(); break;
    case 0x09: PlayerChangeSize(); break;
    case 0x0a: PlayerInjuryBlink(); break;
    case 0x0b: PlayerDeath(); break;
    case 0x0c: PlayerFireFlower(); break;
  }
}

function PlayerEntrance() {
  if (ram[AltEntranceControl] === 0x02) {
    // EntrMode2
    if (ram[JoypadOverride]) {
      // VineEntr
      if (ram[VineHeight] !== 0x60) return;
      let y = 0;
      let a = 0x01;
      if (ram[Player_Y_Position] >= 0x99) {
        ram[Player_State] = 0x03;
        y++;
        a = 0x08;
        ram[Block_Buffer_1 + 0xb4] = a;
      }
      ram[DisableCollisionDet] = y;
      AutoControlPlayer(a);
      if (ram[Player_X_Position] < 0x48) return;
      PlayerRdy();
      return;
    }
    MovePlayerYAxis(0xff);
    if (ram[Player_Y_Position] < 0x91) PlayerRdy();
    return;
  }
  if (ram[Player_Y_Position] < 0x30) {
    AutoControlPlayer(0);
    return;
  }
  const pe = ram[PlayerEntranceCtrl];
  if (pe === 0x06 || pe === 0x07) {
    if (ram[Player_SprAttrib] === 0) {
      AutoControlPlayer(0x01);
      return;
    }
    EnterSidePipe();
    if (decRam(ChangeAreaTimer) !== 0) return;
    ram[DisableIntermediate]++;
    NextArea();
    return;
  }
  PlayerRdy();
}

function PlayerRdy() {
  ram[GameEngineSubroutine] = 0x08;
  ram[PlayerFacingDir] = 0x01;
  ram[AltEntranceControl] = 0;
  ram[DisableCollisionDet] = 0;
  ram[JoypadOverride] = 0;
}

function AutoControlPlayer(a) {
  ram[SavedJoypadBits] = a;
  PlayerCtrlRoutine();
}

function PlayerCtrlRoutine() {
  if (ram[GameEngineSubroutine] !== 0x0b) {
    if (ram[AreaType] === 0) {
      if (ram[Player_Y_HighPos] !== 1 || ram[Player_Y_Position] >= 0xd0) ram[SavedJoypadBits] = 0;
    }
    const j = ram[SavedJoypadBits];
    ram[A_B_Buttons] = j & 0xc0;
    ram[Left_Right_Buttons] = j & 0x03;
    ram[Up_Down_Buttons] = j & 0x0c;
    if ((j & 0x04) && ram[Player_State] === 0 && ram[Left_Right_Buttons]) {
      ram[Left_Right_Buttons] = 0;
      ram[Up_Down_Buttons] = 0;
    }
  }
  // SizeChk
  PlayerMovementSubs();
  let y = 1;
  if (ram[PlayerSize] === 0) {
    y = 0;
    if (ram[CrouchingFlag]) y = 2;
  }
  ram[Player_BoundBoxCtrl] = y;
  const xs = ram[Player_X_Speed];
  if (xs !== 0) ram[Player_MovingDir] = neg(xs) ? 2 : 1;
  // PlayerSubs
  ScrollHandler();
  GetPlayerOffscreenBits();
  RelativePlayerPosition();
  BoundingBoxCore(0, 0);
  PlayerBGCollision();
  if (ram[Player_Y_Position] >= 0x40) {
    const g = ram[GameEngineSubroutine];
    if (g !== 0x05 && g !== 0x07 && g >= 0x04) ram[Player_SprAttrib] &= 0xdf;
  }
  // PlayerHole
  const hp = ram[Player_Y_HighPos];
  if (neg((hp - 2) & 0xff)) return;
  ram[ScrollLock] = 1;
  ram[0x07] = 0x04;
  let flag = 0;
  let toChk = false;
  if (!ram[GameTimerExpiredFlag] && ram[CloudTypeOverride]) {
    toChk = true;
  }
  if (!toChk) {
    // HoleDie
    flag++;
    if (ram[GameEngineSubroutine] !== 0x0b) {
      if (!ram[DeathMusicLoaded]) {
        ram[EventMusicQueue] = 1;
        ram[DeathMusicLoaded] = 1;
      }
      ram[0x07] = 0x06;
    }
  }
  // ChkHoleX
  if (neg((hp - ram[0x07]) & 0xff)) return;
  flag--;
  if (flag < 0) {
    // CloudExit
    ram[JoypadOverride] = 0;
    SetEntr();
    ram[AltEntranceControl]++;
    return;
  }
  if (ram[EventMusicBuffer]) return;
  ram[GameEngineSubroutine] = 0x06;
}

function Vine_AutoClimb() {
  if (ram[Player_Y_HighPos] === 0 && ram[Player_Y_Position] < 0xe4) {
    SetEntr();
    return;
  }
  ram[JoypadOverride] = 0x08;
  ram[Player_State] = 0x03;
  AutoControlPlayer(0x08);
}

function SetEntr() {
  ram[AltEntranceControl] = 0x02;
  ChgAreaMode();
}

function VerticalPipeEntry() {
  MovePlayerYAxis(0x01);
  ScrollHandler();
  let y = 0;
  if (!ram[WarpZoneControl]) {
    y++;
    if (ram[AreaType] === 0x03) y++;
  }
  ChgAreaPipe(y);
}

function MovePlayerYAxis(a) {
  ram[Player_Y_Position] = add(a, ram[Player_Y_Position]);
}

function SideExitPipeEntry() {
  EnterSidePipe();
  ChgAreaPipe(0x02);
}

function ChgAreaPipe(y) {
  if (decRam(ChangeAreaTimer) !== 0) return;
  ram[AltEntranceControl] = y;
  ChgAreaMode();
}

function ChgAreaMode() {
  ram[DisableScreenFlag]++;
  ram[OperMode_Task] = 0;
  ram[Sprite0HitDetectFlag] = 0;
  return 0;
}

function EnterSidePipe() {
  ram[Player_X_Speed] = 0x08;
  let y = 0x01;
  if ((ram[Player_X_Position] & 0x0f) === 0) {
    ram[Player_X_Speed] = 0;
    y = 0;
  }
  AutoControlPlayer(y);
}

function PlayerChangeSize() {
  const t = ram[TimerControl];
  if (t === 0xf8) {
    InitChangeSize();
    return;
  }
  if (t === 0xc4) DonePlayerTask();
}

function PlayerInjuryBlink() {
  const t = ram[TimerControl];
  if (t >= 0xf0) {
    if (t !== 0xf0) return; // ExitBlink: BNE ExitBoth
    InitChangeSize();
    return;
  }
  if (t === 0xc8) {
    DonePlayerTask();
    return;
  }
  PlayerCtrlRoutine();
}

function InitChangeSize() {
  if (ram[PlayerChangeSizeFlag]) return;
  ram[PlayerAnimCtrl] = 0;
  ram[PlayerChangeSizeFlag]++;
  ram[PlayerSize] ^= 0x01;
}

function PlayerDeath() {
  if (ram[TimerControl] >= 0xf0) return;
  PlayerCtrlRoutine();
}

function DonePlayerTask() {
  ram[TimerControl] = 0;
  ram[GameEngineSubroutine] = 0x08;
}

function PlayerFireFlower() {
  if (ram[TimerControl] === 0xc0) {
    DonePlayerTask();
    ResetPalStar();
    return;
  }
  CyclePlayerPalette(ram[FrameCounter] >> 2);
}

function CyclePlayerPalette(a) {
  ram[Player_SprAttrib] = (ram[Player_SprAttrib] & 0xfc) | (a & 0x03);
}

function ResetPalStar() {
  ram[Player_SprAttrib] &= 0xfc;
}

function FlagpoleSlide() {
  if (ram[Enemy_ID + 5] !== FlagpoleFlagObject) {
    ram[GameEngineSubroutine]++;
    return;
  }
  ram[Square1SoundQueue] = ram[FlagpoleSoundQueue];
  ram[FlagpoleSoundQueue] = 0;
  AutoControlPlayer(ram[Player_Y_Position] >= 0x9e ? 0x00 : 0x04);
}

function PlayerEndLevel() {
  AutoControlPlayer(0x01);
  if (ram[Player_Y_Position] >= 0xae && ram[ScrollLock]) {
    ram[EventMusicQueue] = EndOfLevelMusic;
    ram[ScrollLock] = 0;
  }
  // ChkStop
  if (!(ram[Player_CollisionBits] & 1)) {
    if (!ram[StarFlagTaskControl]) ram[StarFlagTaskControl]++;
    ram[Player_SprAttrib] = 0x20;
  }
  // RdyNextA
  if (ram[StarFlagTaskControl] !== 0x05) return;
  ram[LevelNumber]++;
  if (ram[LevelNumber] === 0x03) {
    if (ram[CoinTallyFor1Ups] >= ROM[L.Hidden1UpCoinAmts + ram[WorldNumber]]) ram[Hidden1UpFlag]++;
  }
  NextArea();
}

function NextArea() {
  ram[AreaNumber]++;
  LoadAreaPointer();
  ram[FetchNewGameTimerFlag]++;
  ChgAreaMode();
  ram[HalfwayPage] = 0;
  ram[EventMusicQueue] = Silence;
}

// -------------------------------------------------------------------------------------

function PlayerMovementSubs() {
  if (ram[PlayerSize] !== 0) {
    ram[CrouchingFlag] = 0;
  } else if (ram[Player_State] === 0) {
    ram[CrouchingFlag] = ram[Up_Down_Buttons] & 0x04;
  }
  PlayerPhysicsSub();
  if (ram[PlayerChangeSizeFlag]) return;
  if (ram[Player_State] !== 0x03) ram[ClimbSideTimer] = 0x18;
  switch (ram[Player_State]) {
    case 0: OnGroundStateSub(); break;
    case 1: JumpSwimSub(); break;
    case 2: FallingSub(); break;
    case 3: ClimbingSub(); break;
  }
}

function OnGroundStateSub() {
  GetPlayerAnimSpeed();
  if (ram[Left_Right_Buttons]) ram[PlayerFacingDir] = ram[Left_Right_Buttons];
  ImposeFriction(ram[Left_Right_Buttons]);
  ram[Player_X_Scroll] = MovePlayerHorizontally();
}

function FallingSub() {
  ram[VerticalForce] = ram[VerticalForceDown];
  LRAir();
}

function JumpSwimSub() {
  let dump = false;
  if (!neg(ram[Player_Y_Speed])) {
    dump = true;
  } else if (!(ram[A_B_Buttons] & A_Button & ram[PreviousA_B_Buttons])) {
    const d = (ram[JumpOrigin_Y_Position] - ram[Player_Y_Position]) & 0xff;
    if (d >= ram[DiffToHaltJump]) dump = true;
  }
  if (dump) ram[VerticalForce] = ram[VerticalForceDown];
  // ProcSwim
  if (ram[SwimmingFlag]) {
    GetPlayerAnimSpeed();
    if (ram[Player_Y_Position] < 0x14) ram[VerticalForce] = 0x18;
    if (ram[Left_Right_Buttons]) ram[PlayerFacingDir] = ram[Left_Right_Buttons];
  }
  LRAir();
}

function LRAir() {
  if (ram[Left_Right_Buttons]) ImposeFriction(ram[Left_Right_Buttons]);
  ram[Player_X_Scroll] = MovePlayerHorizontally();
  if (ram[GameEngineSubroutine] === 0x0b) ram[VerticalForce] = 0x28;
  MovePlayerVertically();
}

function ClimbingSub() {
  ram[Player_YMF_Dummy] = add(ram[Player_YMF_Dummy], ram[Player_Y_MoveForce]);
  const hi = neg(ram[Player_Y_Speed]) ? 0xff : 0x00;
  ram[0x00] = hi;
  ram[Player_Y_Position] = adc(ram[Player_Y_Speed], ram[Player_Y_Position]);
  ram[Player_Y_HighPos] = adc(ram[Player_Y_HighPos], hi);
  const a = ram[Left_Right_Buttons] & ram[Player_CollisionBits];
  if (a === 0) {
    ram[ClimbSideTimer] = 0;
    return;
  }
  if (ram[ClimbSideTimer]) return;
  ram[ClimbSideTimer] = 0x18;
  let x = 0;
  if (!(a & 1)) x += 2;
  if (ram[PlayerFacingDir] !== 1) x++;
  ram[Player_X_Position] = add(ram[Player_X_Position], ROM[L.ClimbAdderLow + x]);
  ram[Player_PageLoc] = adc(ram[Player_PageLoc], ROM[L.ClimbAdderHigh + x]);
  ram[PlayerFacingDir] = ram[Left_Right_Buttons] ^ 0x03;
}

function PlayerPhysicsSub() {
  if (ram[Player_State] === 0x03) {
    let y = 0;
    const a = ram[Up_Down_Buttons] & ram[Player_CollisionBits];
    if (a) {
      y = 1;
      if (!(a & 0x08)) y = 2;
    }
    ram[Player_Y_MoveForce] = ROM[L.Climb_Y_MForceData + y];
    const spd = ROM[L.Climb_Y_SpeedData + y];
    ram[Player_Y_Speed] = spd;
    ram[PlayerAnimTimerSet] = neg(spd) ? 0x08 : 0x04;
    return;
  }
  // CheckForJumping
  let jump = false;
  if (!ram[JumpspringAnimCtrl] && (ram[A_B_Buttons] & A_Button) && !(ram[A_B_Buttons] & A_Button & ram[PreviousA_B_Buttons])) {
    // ProcJumping
    if (ram[Player_State] === 0) jump = true;
    else if (ram[SwimmingFlag]) {
      if (ram[JumpSwimTimer] || !neg(ram[Player_Y_Speed])) jump = true;
    }
  }
  if (jump) {
    // InitJS
    ram[JumpSwimTimer] = 0x20;
    let y = 0;
    ram[Player_YMF_Dummy] = 0;
    ram[Player_Y_MoveForce] = 0;
    ram[JumpOrigin_Y_HighPos] = ram[Player_Y_HighPos];
    ram[JumpOrigin_Y_Position] = ram[Player_Y_Position];
    ram[Player_State] = 0x01;
    const s = ram[Player_XSpeedAbsolute];
    if (s >= 0x09) {
      y++;
      if (s >= 0x10) {
        y++;
        if (s >= 0x19) {
          y++;
          if (s >= 0x1c) y++;
        }
      }
    }
    ram[DiffToHaltJump] = 0x01;
    if (ram[SwimmingFlag]) {
      y = 0x05;
      if (ram[Whirlpool_Flag]) y++;
    }
    ram[VerticalForce] = ROM[L.JumpMForceData + y];
    ram[VerticalForceDown] = ROM[L.FallMForceData + y];
    ram[Player_Y_MoveForce] = ROM[L.InitMForceData + y];
    ram[Player_Y_Speed] = ROM[L.PlayerYSpdData + y];
    if (ram[SwimmingFlag]) {
      ram[Square1SoundQueue] = Sfx_EnemyStomp;
      if (ram[Player_Y_Position] < 0x14) ram[Player_Y_Speed] = 0;
    } else {
      ram[Square1SoundQueue] = ram[PlayerSize] ? Sfx_SmallJump : Sfx_BigJump;
    }
  }
  X_Physics();
}

function X_Physics() {
  let y = 0;
  ram[0x00] = 0;
  let path; // 'getx' | 'chkrfast' | 'setrtmr'
  if (ram[Player_State] !== 0) {
    path = ram[Player_XSpeedAbsolute] >= 0x19 ? 'getx' : 'chkrfast';
  } else {
    // ProcPRun
    y++;
    if (ram[AreaType] === 0) path = 'chkrfast';
    else {
      y--;
      if (ram[Left_Right_Buttons] !== ram[Player_MovingDir]) path = 'chkrfast';
      else if (ram[A_B_Buttons] & B_Button) path = 'setrtmr';
      else if (ram[RunningTimer]) path = 'getx';
      else path = 'chkrfast';
    }
  }
  if (path === 'chkrfast') {
    y++;
    ram[0x00]++;
    if (ram[RunningSpeed] || ram[Player_XSpeedAbsolute] >= 0x21) ram[0x00]++;
  } else if (path === 'setrtmr') {
    ram[RunningTimer] = 0x0a;
  }
  // GetXPhy
  ram[MaximumLeftSpeed] = ROM[L.MaxLeftXSpdData + y];
  if (ram[GameEngineSubroutine] === 0x07) y = 0x03;
  ram[MaximumRightSpeed] = ROM[L.MaxRightXSpdData + y];
  ram[FrictionAdderLow] = ROM[L.FrictionData + ram[0x00]];
  ram[FrictionAdderHigh] = 0;
  if (ram[PlayerFacingDir] !== ram[Player_MovingDir]) {
    ram[FrictionAdderLow] = asl(ram[FrictionAdderLow]);
    ram[FrictionAdderHigh] = rol(ram[FrictionAdderHigh]);
  }
}

function GetPlayerAnimSpeed() {
  let y = 0;
  const s = ram[Player_XSpeedAbsolute];
  if (s >= 0x1c) {
    ram[RunningSpeed] = s;
  } else {
    y++;
    if (s < 0x0e) y++;
    const j = ram[SavedJoypadBits] & 0x7f;
    if (j !== 0) {
      if ((j & 0x03) === ram[Player_MovingDir]) {
        ram[RunningSpeed] = 0;
      } else if (ram[Player_XSpeedAbsolute] < 0x0b) {
        ram[Player_MovingDir] = ram[PlayerFacingDir];
        ram[Player_X_Speed] = 0;
        ram[Player_X_MoveForce] = 0;
      }
    }
  }
  ram[PlayerAnimTimerSet] = ROM[L.PlayerAnimTmrData + y];
}

function ImposeFriction(a) {
  a &= ram[Player_CollisionBits];
  let right; // true = apply RghtFrict (subtract), false = LeftFrict (add)
  if (a === 0) {
    const s = ram[Player_X_Speed];
    if (s === 0) {
      ram[Player_XSpeedAbsolute] = 0;
      return;
    }
    right = !neg(s);
  } else {
    right = !(a & 1);
  }
  let v;
  if (!right) {
    ram[Player_X_MoveForce] = add(ram[Player_X_MoveForce], ram[FrictionAdderLow]);
    v = adc(ram[Player_X_Speed], ram[FrictionAdderHigh]);
    ram[Player_X_Speed] = v;
    if (!neg((v - ram[MaximumRightSpeed]) & 0xff)) {
      v = ram[MaximumRightSpeed];
      ram[Player_X_Speed] = v;
      ram[Player_XSpeedAbsolute] = v;
      return;
    }
  } else {
    ram[Player_X_MoveForce] = sub(ram[Player_X_MoveForce], ram[FrictionAdderLow]);
    v = sbc(ram[Player_X_Speed], ram[FrictionAdderHigh]);
    ram[Player_X_Speed] = v;
    if (neg((v - ram[MaximumLeftSpeed]) & 0xff)) {
      v = ram[MaximumLeftSpeed];
      ram[Player_X_Speed] = v;
    }
  }
  // XSpdSign
  if (neg(v)) v = twos(v);
  ram[Player_XSpeedAbsolute] = v;
}

// -------------------------------------------------------------------------------------

function ProcFireball_Bubble() {
  if (ram[PlayerStatus] >= 0x02) {
    const ab = ram[A_B_Buttons];
    if ((ab & B_Button) && !(ab & B_Button & ram[PreviousA_B_Buttons])) {
      const x = ram[FireballCounter] & 0x01;
      if (!ram[Fireball_State + x] && ram[Player_Y_HighPos] === 1 && !ram[CrouchingFlag] && ram[Player_State] !== 0x03) {
        ram[Square1SoundQueue] = Sfx_Fireball;
        ram[Fireball_State + x] = 0x02;
        const t = ram[PlayerAnimTimerSet];
        ram[FireballThrowingTimer] = t;
        ram[PlayerAnimTimer] = (t - 1) & 0xff;
        ram[FireballCounter]++;
      }
    }
    FireballObjCore(0);
    FireballObjCore(1);
  }
  // ProcAirBubbles
  if (ram[AreaType] !== 0) return;
  for (let x = 2; x >= 0; x--) {
    ram[ObjectOffset] = x;
    BubbleCheck(x);
    RelativeBubblePosition(x);
    GetBubbleOffscreenBits(x);
    DrawBubble(x);
  }
}

function FireballObjCore(x) {
  ram[ObjectOffset] = x;
  const st = ram[Fireball_State + x];
  if (st & 0x80) {
    RelativeFireballPosition(x);
    DrawExplosion_Fireball(x);
    return;
  }
  if (st === 0) return;
  if (st !== 1) {
    C = 0;
    ram[Fireball_X_Position + x] = adc(ram[Player_X_Position], 0x04);
    ram[Fireball_PageLoc + x] = adc(ram[Player_PageLoc], 0x00);
    ram[Fireball_Y_Position + x] = ram[Player_Y_Position];
    ram[Fireball_Y_HighPos + x] = 0x01;
    ram[Fireball_X_Speed + x] = ROM[L.FireballXSpdData + ram[PlayerFacingDir] - 1];
    ram[Fireball_Y_Speed + x] = 0x04;
    ram[Fireball_BoundBoxCtrl + x] = 0x07;
    ram[Fireball_State + x]--;
  }
  // RunFB
  const so = x + 7;
  ram[0x00] = 0x50;
  ram[0x02] = 0x03;
  ImposeGravity(so, 0);
  MoveObjectHorizontally(so);
  RelativeFireballPosition(x);
  GetFireballOffscreenBits(x);
  GetFireballBoundBox(x);
  FireballBGCollision(x);
  if (ram[FBall_OffscreenBits] & 0xcc) {
    ram[Fireball_State + x] = 0;
    return;
  }
  FireballEnemyCollision(x);
  DrawFireball(x);
}

function BubbleCheck(x) {
  ram[0x07] = ram[PseudoRandomBitReg + 1 + x] & 0x01;
  if (ram[Bubble_Y_Position + x] === 0xf8) {
    if (ram[AirBubbleTimer]) return;
    SetupBubble(x);
  }
  MoveBubl(x);
}

function SetupBubble(x) {
  let y = 0;
  C = ram[PlayerFacingDir] & 1;
  if (C) y = 0x08;
  ram[Bubble_X_Position + x] = adc(y, ram[Player_X_Position]);
  ram[Bubble_PageLoc + x] = adc(ram[Player_PageLoc], 0);
  ram[Bubble_Y_Position + x] = add(ram[Player_Y_Position], 0x08);
  ram[Bubble_Y_HighPos + x] = 0x01;
  ram[AirBubbleTimer] = ROM[L.BubbleTimerData + ram[0x07]];
}

function MoveBubl(x) {
  const y = ram[0x07];
  ram[Bubble_YMF_Dummy + x] = sub(ram[Bubble_YMF_Dummy + x], ROM[L.Bubble_MForceData + y]);
  let a = sbc(ram[Bubble_Y_Position + x], 0);
  if (a < 0x20) a = 0xf8;
  ram[Bubble_Y_Position + x] = a;
}

// -------------------------------------------------------------------------------------

function RunGameTimer() {
  if (ram[OperMode] === 0) return;
  const g = ram[GameEngineSubroutine];
  if (g < 0x08 || g === 0x0b) return;
  if (ram[Player_Y_HighPos] >= 0x02) return;
  if (ram[GameTimerCtrlTimer]) return;
  if ((ram[GameTimerDisplay] | ram[GameTimerDisplay + 1] | ram[GameTimerDisplay + 2]) === 0) {
    // TimeUpOn
    ram[PlayerStatus] = 0;
    ForceInjury(0);
    ram[GameTimerExpiredFlag]++;
    return;
  }
  if (ram[GameTimerDisplay] === 1 && (ram[GameTimerDisplay + 1] | ram[GameTimerDisplay + 2]) === 0) {
    ram[EventMusicQueue] = TimeRunningOutMusic;
  }
  ram[GameTimerCtrlTimer] = 0x18;
  ram[DigitModifier + 5] = 0xff;
  DigitsMathRoutine(0x23);
  PrintStatusBarNumbers(0xa4);
}

function WarpZoneObject(x) {
  if (!ram[ScrollLock]) return;
  if (ram[Player_Y_Position] & ram[Player_Y_HighPos]) return;
  ram[ScrollLock] = 0;
  ram[WarpZoneControl]++;
  EraseEnemyObject(x);
}

function ProcessWhirlpools() {
  if (ram[AreaType] !== 0) return;
  ram[Whirlpool_Flag] = 0;
  if (ram[TimerControl]) return;
  for (let y = 4; y >= 0; y--) {
    ram[0x02] = add(ram[Whirlpool_LeftExtent + y], ram[Whirlpool_Length + y]);
    const pl = ram[Whirlpool_PageLoc + y];
    if (pl === 0) continue;
    ram[0x01] = adc(pl, 0);
    C = 1;
    sbc(ram[Player_X_Position], ram[Whirlpool_LeftExtent + y]);
    if (neg(sbc(ram[Player_PageLoc], ram[Whirlpool_PageLoc + y]))) continue;
    C = 1;
    sbc(ram[0x02], ram[Player_X_Position]);
    if (!neg(sbc(ram[0x01], ram[Player_PageLoc]))) {
      WhirlpoolActivate(y);
      return;
    }
  }
}

function WhirlpoolActivate(y) {
  ram[0x00] = ram[Whirlpool_Length + y] >> 1;
  ram[0x01] = add(ram[Whirlpool_LeftExtent + y], ram[0x00]);
  ram[0x00] = adc(ram[Whirlpool_PageLoc + y], 0);
  if (ram[FrameCounter] & 1) {
    C = 1;
    sbc(ram[0x01], ram[Player_X_Position]);
    if (neg(sbc(ram[0x00], ram[Player_PageLoc]))) {
      ram[Player_X_Position] = sub(ram[Player_X_Position], 0x01);
      ram[Player_PageLoc] = sbc(ram[Player_PageLoc], 0x00);
    } else if (ram[Player_CollisionBits] & 1) {
      ram[Player_X_Position] = add(ram[Player_X_Position], 0x01);
      ram[Player_PageLoc] = adc(ram[Player_PageLoc], 0x00);
    }
  }
  // WhPull
  ram[0x00] = 0x10;
  ram[Whirlpool_Flag] = 0x01;
  ram[0x02] = 0x01;
  ImposeGravity(0, 0);
}

function FlagpoleRoutine() {
  const x = 0x05;
  ram[ObjectOffset] = x;
  if (ram[Enemy_ID + x] !== FlagpoleFlagObject) return;
  if (ram[GameEngineSubroutine] === 0x04 && ram[Player_State] === 0x03) {
    if (ram[Enemy_Y_Position + x] >= 0xaa || ram[Player_Y_Position] >= 0xa2) {
      // GiveFPScr
      const y = ram[FlagpoleScore];
      ram[DigitModifier + ROM[L.FlagpoleScoreDigits + y]] = ROM[L.FlagpoleScoreMods + y];
      AddToScore();
      ram[GameEngineSubroutine] = 0x05;
    } else {
      C = 0;
      ram[Enemy_YMF_Dummy + x] = adc(ram[Enemy_YMF_Dummy + x], 0xff);
      ram[Enemy_Y_Position + x] = adc(ram[Enemy_Y_Position + x], 0x01);
      ram[FlagpoleFNum_YMFDummy] = sub(ram[FlagpoleFNum_YMFDummy], 0xff);
      ram[FlagpoleFNum_Y_Pos] = sbc(ram[FlagpoleFNum_Y_Pos], 0x01);
    }
  }
  // FPGfx
  GetEnemyOffscreenBits(x);
  RelativeEnemyPosition(x);
  FlagpoleGfxHandler(x);
}

function JumpspringHandler(x) {
  GetEnemyOffscreenBits(x);
  if (!ram[TimerControl] && ram[JumpspringAnimCtrl]) {
    const y = (ram[JumpspringAnimCtrl] - 1) & 0xff;
    if (y & 0x02) {
      ram[Player_Y_Position] = (ram[Player_Y_Position] - 2) & 0xff;
    } else {
      ram[Player_Y_Position] = (ram[Player_Y_Position] + 2) & 0xff;
    }
    ram[Enemy_Y_Position + x] = add(ram[Jumpspring_FixedYPos + x], ROM[L.Jumpspring_Y_PosData + y]);
    if (y >= 0x01) {
      const ab = ram[A_B_Buttons];
      if ((ab & A_Button) && !(ab & A_Button & ram[PreviousA_B_Buttons])) ram[JumpspringForce] = 0xf4;
    }
    if (y === 0x03) {
      ram[Player_Y_Speed] = ram[JumpspringForce];
      ram[JumpspringAnimCtrl] = 0;
    }
  }
  // DrawJSpr
  RelativeEnemyPosition(x);
  EnemyGfxHandler(x);
  OffscreenBoundsCheck(x);
  if (!ram[JumpspringAnimCtrl]) return;
  if (ram[JumpspringTimer]) return;
  ram[JumpspringTimer] = 0x04;
  ram[JumpspringAnimCtrl]++;
}

function Setup_Vine(x, y) {
  ram[Enemy_ID + x] = VineObject;
  ram[Enemy_Flag + x] = 0x01;
  ram[Enemy_PageLoc + x] = ram[Block_PageLoc + y];
  ram[Enemy_X_Position + x] = ram[Block_X_Position + y];
  const yp = ram[Block_Y_Position + y];
  ram[Enemy_Y_Position + x] = yp;
  const vo = ram[VineFlagOffset];
  if (vo === 0) ram[VineStart_Y_Position] = yp;
  ram[VineObjOffset + vo] = x;
  ram[VineFlagOffset]++;
  ram[Square2SoundQueue] = Sfx_GrowVine;
}

function VineObjectHandler(x) {
  if (x !== 0x05) return;
  const y0 = (ram[VineFlagOffset] - 1) & 0xff;
  if (ram[VineHeight] !== ROM[L.VineHeightData + y0]) {
    if (ram[FrameCounter] & 0x02) {
      ram[Enemy_Y_Position + 5] = (ram[Enemy_Y_Position + 5] - 1) & 0xff;
      ram[VineHeight]++;
    }
  }
  // RunVSubs
  if (ram[VineHeight] < 0x08) return;
  RelativeEnemyPosition(x);
  GetEnemyOffscreenBits(x);
  let y = 0;
  do {
    DrawVine(y);
    y++;
  } while (y !== ram[VineFlagOffset]);
  if (ram[Enemy_OffscreenBits] & 0x0c) {
    y--;
    for (; y >= 0; y--) EraseEnemyObject(ram[VineObjOffset + y]);
    ram[VineFlagOffset] = 0;
    ram[VineHeight] = 0;
  }
  // WrCMTile
  if (ram[VineHeight] < 0x20) return;
  BlockBufferCollision(0x06, 0x01, 0x1b);
  const by = ram[0x02];
  if (by >= 0xd0) return;
  const addr = ptr(0x06) + by;
  if (ram[addr] !== 0) return;
  ram[addr] = 0x26;
}

function ProcessCannons() {
  if (ram[AreaType] === 0) return;
  for (let x = 2; x >= 0; x--) {
    ram[ObjectOffset] = x;
    let chk = true;
    if (!ram[Enemy_Flag + x]) {
      const a = ram[PseudoRandomBitReg + 1 + x] & ROM[L.CannonBitmasks + ram[SecondaryHardMode]];
      if (a < 0x06) {
        const y = a;
        if (ram[Cannon_PageLoc + y]) {
          if (ram[Cannon_Timer + y]) {
            ram[Cannon_Timer + y] = (ram[Cannon_Timer + y] - 1) & 0xff;
          } else if (!ram[TimerControl]) {
            // FireCannon
            ram[Cannon_Timer + y] = 0x0e;
            ram[Enemy_PageLoc + x] = ram[Cannon_PageLoc + y];
            ram[Enemy_X_Position + x] = ram[Cannon_X_Position + y];
            ram[Enemy_Y_Position + x] = sub(ram[Cannon_Y_Position + y], 0x08);
            ram[Enemy_Y_HighPos + x] = 0x01;
            ram[Enemy_Flag + x] = 0x01;
            ram[Enemy_State + x] = 0x00;
            ram[Enemy_BoundBoxCtrl + x] = 0x09;
            ram[Enemy_ID + x] = BulletBill_CannonVar;
            chk = false;
          }
        }
      }
    }
    if (chk && ram[Enemy_ID + x] === BulletBill_CannonVar) {
      OffscreenBoundsCheck(x);
      if (ram[Enemy_Flag + x]) {
        GetEnemyOffscreenBits(x);
        BulletBillHandler(x);
      }
    }
  }
}

function BulletBillHandler(x) {
  if (!ram[TimerControl]) {
    if (ram[Enemy_State + x] === 0) {
      if ((ram[Enemy_OffscreenBits] & 0x0c) === 0x0c) {
        EraseEnemyObject(x);
        return;
      }
      let y = 0x01;
      if (!neg(PlayerEnemyDiff(x))) y++;
      const c = C;
      ram[Enemy_MovingDir + x] = y;
      ram[Enemy_X_Speed + x] = ROM[L.BulletBillXSpdData + y - 1];
      C = c;
      if (adc(ram[0x00], 0x28) < 0x50) {
        EraseEnemyObject(x);
        return;
      }
      ram[Enemy_State + x] = 0x01;
      ram[EnemyFrameTimer + x] = 0x0a;
      ram[Square2SoundQueue] = Sfx_Blast;
    }
    // ChkDSte
    if (ram[Enemy_State + x] & 0x20) MoveD_EnemyVertically(x);
    MoveEnemyHorizontally(x);
  }
  // RunBBSubs
  GetEnemyOffscreenBits(x);
  RelativeEnemyPosition(x);
  GetEnemyBoundBox(x);
  PlayerEnemyCollision(x);
  EnemyGfxHandler(x);
}

// returns carry set if a hammer was spawned
function SpawnHammerObj() {
  let a = ram[PseudoRandomBitReg + 1] & 0x07;
  if (a === 0) a = ram[PseudoRandomBitReg + 1] & 0x08;
  const y = a;
  if (ram[Misc_State + y] || ram[Enemy_Flag + ROM[L.HammerEnemyOfsData + y]]) {
    C = 0;
    return false;
  }
  ram[HammerEnemyOffset + y] = ram[ObjectOffset];
  ram[Misc_State + y] = 0x90;
  ram[Misc_BoundBoxCtrl + y] = 0x07;
  C = 1;
  return true;
}

function ProcHammerObj(x) {
  if (!ram[TimerControl]) {
    const st = ram[Misc_State + x] & 0x7f;
    const y = ram[HammerEnemyOffset + x];
    if (st < 0x02) {
      const so = x + 0x0d;
      ram[0x00] = 0x10;
      ram[0x01] = 0x0f;
      ram[0x02] = 0x04;
      ImposeGravity(so, 0);
      MoveObjectHorizontally(so);
      PlayerHammerCollision(x);
    } else {
      if (st === 0x02) {
        ram[Misc_Y_Speed + x] = 0xfe;
        ram[Enemy_State + y] &= 0xf7;
        ram[Misc_X_Speed + x] = ROM[L.HammerXSpdData + ram[Enemy_MovingDir + y] - 1];
      }
      // SetHPos
      ram[Misc_State + x]--;
      ram[Misc_X_Position + x] = add(ram[Enemy_X_Position + y], 0x02);
      ram[Misc_PageLoc + x] = adc(ram[Enemy_PageLoc + y], 0x00);
      ram[Misc_Y_Position + x] = sub(ram[Enemy_Y_Position + y], 0x0a);
      ram[Misc_Y_HighPos + x] = 0x01;
    }
  }
  // RunHSubs
  GetMiscOffscreenBits(x);
  RelativeMiscPosition(x);
  GetMiscBoundBox(x);
  DrawHammer(x);
}

// -------------------------------------------------------------------------------------

function CoinBlock(x) {
  C = 0; // carry state left by the block jump table
  const y = FindEmptyMiscSlot();
  ram[Misc_PageLoc + y] = ram[Block_PageLoc + x];
  ram[Misc_X_Position + y] = ram[Block_X_Position + x] | 0x05;
  ram[Misc_Y_Position + y] = sbc(ram[Block_Y_Position + x], 0x10);
  JCoinC(x, y);
}

function SetupJumpCoin(x) {
  const y = FindEmptyMiscSlot();
  ram[Misc_PageLoc + y] = ram[Block_PageLoc2 + x];
  C = (ram[0x06] >> 4) & 1; // carry from the last ASL
  ram[Misc_X_Position + y] = ((ram[0x06] << 4) & 0xff) | 0x05;
  ram[Misc_Y_Position + y] = adc(ram[0x02], 0x20);
  JCoinC(x, y);
}

function JCoinC(x, y) {
  ram[Misc_Y_Speed + y] = 0xfb;
  ram[Misc_Y_HighPos + y] = 0x01;
  ram[Misc_State + y] = 0x01;
  ram[Square2SoundQueue] = 0x01;
  ram[ObjectOffset] = x;
  GiveOneCoin();
  ram[CoinTallyFor1Ups]++;
}

function FindEmptyMiscSlot() {
  let y = 8;
  for (;;) {
    if (ram[Misc_State + y] === 0) break;
    y--;
    C = y >= 5 ? 1 : 0;
    if (y === 5) {
      y = 8;
      break;
    }
  }
  ram[JumpCoinMiscOffset] = y;
  return y;
}

function MiscObjectsCore() {
  for (let x = 8; x >= 0; x--) {
    ram[ObjectOffset] = x;
    const st = ram[Misc_State + x];
    if (st === 0) continue;
    if (st & 0x80) {
      ProcHammerObj(x);
      continue;
    }
    ProcJumpCoin(x);
  }
}

function ProcJumpCoin(x) {
  if (ram[Misc_State + x] === 1) {
    // JCoinRun
    ram[0x00] = 0x50;
    ram[0x02] = 0x06;
    ram[0x01] = 0x03;
    ImposeGravity(x + 0x0d, 0);
    if (ram[Misc_Y_Speed + x] === 0x05) ram[Misc_State + x]++;
  } else {
    ram[Misc_State + x]++;
    ram[Misc_X_Position + x] = add(ram[Misc_X_Position + x], ram[ScrollAmount]);
    ram[Misc_PageLoc + x] = adc(ram[Misc_PageLoc + x], 0);
    if (ram[Misc_State + x] === 0x30) {
      ram[Misc_State + x] = 0;
      return;
    }
  }
  // RunJCSubs
  RelativeMiscPosition(x);
  GetMiscOffscreenBits(x);
  GetMiscBoundBox(x);
  JCoinGfxHandler(x);
}

function GiveOneCoin() {
  ram[DigitModifier + 5] = 0x01;
  DigitsMathRoutine(ROM[L.CoinTallyOffsets + ram[CurrentPlayer]]);
  ram[CoinTally]++;
  if (ram[CoinTally] === 100) {
    ram[CoinTally] = 0;
    ram[NumberofLives]++;
    ram[Square2SoundQueue] = Sfx_ExtraLife;
  }
  CoinPoints();
}

function CoinPoints() {
  ram[DigitModifier + 4] = 0x02;
  AddToScore();
}

function AddToScore() {
  DigitsMathRoutine(ROM[L.ScoreOffsets + ram[CurrentPlayer]]);
  GetSBNybbles();
}

function GetSBNybbles() {
  UpdateNumber(ROM[L.StatusBarNybbles + ram[CurrentPlayer]]);
}

function UpdateNumber(a) {
  PrintStatusBarNumbers(a);
  const y = ram[VRAM_Buffer1_Offset];
  if (ram[VRAM_Buffer1 - 6 + y] === 0) ram[VRAM_Buffer1 - 6 + y] = 0x24;
}

// -------------------------------------------------------------------------------------

function SetupPowerUp(x) {
  ram[Enemy_ID + 5] = PowerUpObject;
  ram[Enemy_PageLoc + 5] = ram[Block_PageLoc + x];
  ram[Enemy_X_Position + 5] = ram[Block_X_Position + x];
  ram[Enemy_Y_HighPos + 5] = 0x01;
  ram[Enemy_Y_Position + 5] = sub(ram[Block_Y_Position + x], 0x08);
  PwrUpJmp();
}

function PwrUpJmp() {
  ram[Enemy_State + 5] = 0x01;
  ram[Enemy_Flag + 5] = 0x01;
  ram[Enemy_BoundBoxCtrl + 5] = 0x03;
  if (ram[PowerUpType] < 0x02) {
    let a = ram[PlayerStatus];
    if (a >= 0x02) a >>= 1;
    ram[PowerUpType] = a;
  }
  ram[Enemy_SprAttrib + 5] = 0x20;
  ram[Square2SoundQueue] = Sfx_GrowPowerUp;
}

function PowerUpObjHandler() {
  const x = 0x05;
  ram[ObjectOffset] = x;
  const st = ram[Enemy_State + 5];
  if (st === 0) return;
  if (st & 0x80) {
    if (!ram[TimerControl]) {
      const t = ram[PowerUpType];
      if (t === 0 || t === 0x03) {
        MoveNormalEnemy(x);
        EnemyToBGCollisionDet(x);
      } else if (t === 0x02) {
        MoveJumpingEnemy(x);
        EnemyJump(x);
      }
    }
  } else {
    // GrowThePowerUp
    if (!(ram[FrameCounter] & 0x03)) {
      ram[Enemy_Y_Position + 5]--;
      const old = ram[Enemy_State + 5];
      ram[Enemy_State + 5]++;
      if (old >= 0x11) {
        ram[Enemy_X_Speed + x] = 0x10;
        ram[Enemy_State + 5] = 0x80;
        ram[Enemy_SprAttrib + 5] = 0x00;
        ram[Enemy_MovingDir + x] = 0x01;
      }
    }
    if (ram[Enemy_State + 5] < 0x06) return;
  }
  // RunPUSubs
  RelativeEnemyPosition(x);
  GetEnemyOffscreenBits(x);
  GetEnemyBoundBox(x);
  DrawPowerUp();
  PlayerEnemyCollision(x);
  OffscreenBoundsCheck(x);
}

// -------------------------------------------------------------------------------------

function PlayerHeadCollision(mt) {
  let x = ram[SprDataOffset_Ctrl];
  ram[Block_State + x] = ram[PlayerSize] ? 0x11 : 0x12;
  DestroyBlockMetatile(x);
  x = ram[SprDataOffset_Ctrl];
  const by = ram[0x02];
  ram[Block_Orig_YPos + x] = by;
  ram[Block_BBuf_Low + x] = ram[0x06];
  let a = ram[ptr(0x06) + by];
  BlockBumpedChk(a);
  ram[0x00] = a;
  if (ram[PlayerSize] === 0) a = 0;
  if (C) {
    ram[Block_State + x] = 0x11;
    a = 0xc4;
    const m = ram[0x00];
    if (m === 0x58 || m === 0x5d) {
      if (!ram[BrickCoinTimerFlag]) {
        ram[BrickCoinTimer] = 0x0b;
        ram[BrickCoinTimerFlag]++;
      }
      a = ram[BrickCoinTimer] ? m : 0xc4;
    }
  }
  ram[Block_Metatile + x] = a;
  InitBlock_XY_Pos(x);
  ram[ptr(0x06) + ram[0x02]] = 0x23;
  ram[BlockBounceTimer] = 0x10;
  ram[0x05] = mt;
  const y = (ram[CrouchingFlag] || ram[PlayerSize]) ? 1 : 0;
  ram[Block_Y_Position + x] = (ram[Player_Y_Position] + ROM[L.BlockYPosAdderData + y]) & 0xf0;
  if (ram[Block_State + x] === 0x11) BumpBlock(x);
  else BrickShatter(x);
  ram[SprDataOffset_Ctrl] ^= 0x01;
}

function InitBlock_XY_Pos(x) {
  ram[Block_X_Position + x] = add(ram[Player_X_Position], 0x08) & 0xf0;
  const p = adc(ram[Player_PageLoc], 0x00);
  ram[Block_PageLoc + x] = p;
  ram[Block_PageLoc2 + x] = p;
  ram[Block_Y_HighPos + x] = ram[Player_Y_HighPos];
}

function BumpBlock(x) {
  CheckTopOfBlock();
  x = ram[SprDataOffset_Ctrl];
  ram[Square1SoundQueue] = Sfx_Bump;
  ram[Block_X_Speed + x] = 0;
  ram[Block_Y_MoveForce + x] = 0;
  ram[Player_Y_Speed] = 0;
  ram[Block_Y_Speed + x] = 0xfe;
  const y = BlockBumpedChk(ram[0x05]);
  if (!C) return;
  let n = y;
  if (n >= 0x09) n -= 0x05;
  switch (n) {
    case 0: case 4: ram[PowerUpType] = 0x00; SetupPowerUp(x); break;
    case 1: case 2: case 7: CoinBlock(x); break;
    case 3: case 8: ram[PowerUpType] = 0x03; SetupPowerUp(x); break;
    case 5: Setup_Vine(0x05, ram[SprDataOffset_Ctrl]); break;
    case 6: ram[PowerUpType] = 0x02; SetupPowerUp(x); break;
  }
}

// returns index in Y; carry set if the metatile is a question block or item brick
function BlockBumpedChk(a) {
  for (let y = 0x0d; y >= 0; y--) {
    if (a === ROM[L.BrickQBlockMetatiles + y]) {
      C = 1;
      return y;
    }
  }
  C = 0;
  return 0xff;
}

function BrickShatter(x) {
  CheckTopOfBlock();
  x = ram[SprDataOffset_Ctrl];
  ram[Block_RepFlag + x] = Sfx_BrickShatter;
  ram[NoiseSoundQueue] = Sfx_BrickShatter;
  SpawnBrickChunks(x);
  ram[Player_Y_Speed] = 0xfe;
  ram[DigitModifier + 5] = 0x05;
  AddToScore();
}

function CheckTopOfBlock() {
  let y = ram[0x02];
  if (y === 0) return;
  y = (y - 0x10) & 0xff;
  ram[0x02] = y;
  const addr = ptr(0x06) + y;
  if (ram[addr] !== 0xc2) return;
  ram[addr] = 0;
  RemoveCoin_Axe();
  SetupJumpCoin(ram[SprDataOffset_Ctrl]);
}

function SpawnBrickChunks(x) {
  ram[Block_Orig_XPos + x] = ram[Block_X_Position + x];
  ram[Block_X_Speed + x] = 0xf0;
  ram[Block_X_Speed + 2 + x] = 0xf0;
  ram[Block_Y_Speed + x] = 0xfa;
  ram[Block_Y_Speed + 2 + x] = 0xfc;
  ram[Block_Y_MoveForce + x] = 0;
  ram[Block_Y_MoveForce + 2 + x] = 0;
  ram[Block_PageLoc + 2 + x] = ram[Block_PageLoc + x];
  ram[Block_X_Position + 2 + x] = ram[Block_X_Position + x];
  ram[Block_Y_Position + 2 + x] = add(ram[Block_Y_Position + x], 0x08);
  ram[Block_Y_Speed + x] = 0xfa;
}

function BlockObjectsCore(x) {
  let st = ram[Block_State + x];
  if (st === 0) {
    ram[Block_State + x] = 0;
    return;
  }
  st &= 0x0f;
  const so = x + 9;
  if (st === 1) {
    // BouncingBlockHandler
    ImposeGravityBlock(so);
    RelativeBlockPosition(x);
    GetBlockOffscreenBits(x);
    DrawBlock(x);
    if ((ram[Block_Y_Position + x] & 0x0f) >= 0x05) {
      ram[Block_State + x] = st;
      return;
    }
    ram[Block_RepFlag + x] = 0x01;
    ram[Block_State + x] = 0;
    return;
  }
  ImposeGravityBlock(so);
  MoveObjectHorizontally(so);
  ImposeGravityBlock(so + 2);
  MoveObjectHorizontally(so + 2);
  RelativeBlockPosition(x);
  GetBlockOffscreenBits(x);
  DrawBrickChunks(x);
  if (ram[Block_Y_HighPos + x] === 0) {
    ram[Block_State + x] = st;
    return;
  }
  if (ram[Block_Y_Position + 2 + x] > 0xf0) ram[Block_Y_Position + 2 + x] = 0xf0;
  if (ram[Block_Y_Position + x] < 0xf0) ram[Block_State + x] = st;
  else ram[Block_State + x] = 0;
}

function BlockObjMT_Updater() {
  for (let x = 1; x >= 0; x--) {
    ram[ObjectOffset] = x;
    if (ram[VRAM_Buffer1] !== 0) continue;
    if (!ram[Block_RepFlag + x]) continue;
    ram[0x06] = ram[Block_BBuf_Low + x];
    ram[0x07] = 0x05;
    ram[0x02] = ram[Block_Orig_YPos + x];
    const mt = ram[Block_Metatile + x];
    ram[ptr(0x06) + ram[0x02]] = mt;
    ReplaceBlockMetatile(mt, x);
    ram[Block_RepFlag + x] = 0;
  }
}

// -------------------------------------------------------------------------------------
// shared movement routines (x = sprite object index: 0 player, 1-6 enemies,
// 7-8 fireballs, 9-12 block objects, 13-21 misc objects)

function MoveEnemyHorizontally(x) {
  return MoveObjectHorizontally(x + 1);
}

function MovePlayerHorizontally() {
  if (ram[JumpspringAnimCtrl]) return ram[JumpspringAnimCtrl];
  return MoveObjectHorizontally(0);
}

function MoveObjectHorizontally(x) {
  const s = ram[SprObject_X_Speed + x];
  ram[0x01] = (s << 4) & 0xff;
  let hi = s >> 4;
  if (hi >= 0x08) hi |= 0xf0;
  ram[0x00] = hi;
  ram[0x02] = neg(hi) ? 0xff : 0x00;
  ram[SprObject_X_MoveForce + x] = add(ram[SprObject_X_MoveForce + x], ram[0x01]);
  const c = C;
  ram[SprObject_X_Position + x] = adc(ram[SprObject_X_Position + x], ram[0x00]);
  ram[SprObject_PageLoc + x] = adc(ram[SprObject_PageLoc + x], ram[0x02]);
  C = 0;
  return adc(c, ram[0x00]);
}

function MovePlayerVertically() {
  if (!ram[TimerControl] && ram[JumpspringAnimCtrl]) return;
  ram[0x00] = ram[VerticalForce];
  ImposeGravitySprObj(0, 0x04);
}

function MoveD_EnemyVertically(x) {
  let y = 0x3d;
  if (ram[Enemy_State + x] === 0x05) y = 0x20;
  SetXMoveAmt(x, y, 0x03);
}
function MoveFallingPlatform(x) {
  SetXMoveAmt(x, 0x20, 0x03);
}

function MoveRedPTroopaDown(x) {
  MoveRedPTroopa(x, 0);
}
function MoveRedPTroopaUp(x) {
  MoveRedPTroopa(x, 1);
}
function MoveRedPTroopa(x, dir) {
  ram[0x00] = 0x03;
  ram[0x01] = 0x06;
  ram[0x02] = 0x02;
  ImposeGravity(x + 1, dir);
}

function MoveDropPlatform(x) {
  SetXMoveAmt(x, 0x7f, 0x02);
}
function MoveEnemySlowVert(x) {
  SetXMoveAmt(x, 0x0f, 0x02);
}
function MoveJ_EnemyVertically(x) {
  SetXMoveAmt(x, 0x1c, 0x03);
}
function SetXMoveAmt(x, y, max) {
  ram[0x00] = y;
  ImposeGravitySprObj(x + 1, max);
}

function ImposeGravityBlock(x) {
  ram[0x00] = 0x50;
  ImposeGravitySprObj(x, ROM[L.MaxSpdBlockData + 1]);
}

function ImposeGravitySprObj(x, max) {
  ram[0x02] = max;
  ImposeGravity(x, 0);
}

function MovePlatformDown(x) {
  MovePlatform(x, 0);
}
function MovePlatformUp(x) {
  MovePlatform(x, 1);
}
function MovePlatform(x, dir) {
  ram[0x00] = 0x05;
  ram[0x01] = 0x0a;
  ram[0x02] = 0x03;
  ImposeGravity(x + 1, dir);
}

function ImposeGravity(x, up) {
  ram[SprObject_YMF_Dummy + x] = add(ram[SprObject_YMF_Dummy + x], ram[SprObject_Y_MoveForce + x]);
  const hi = neg(ram[SprObject_Y_Speed + x]) ? 0xff : 0x00;
  ram[0x07] = hi;
  ram[SprObject_Y_Position + x] = adc(ram[SprObject_Y_Speed + x], ram[SprObject_Y_Position + x]);
  ram[SprObject_Y_HighPos + x] = adc(ram[SprObject_Y_HighPos + x], hi);
  ram[SprObject_Y_MoveForce + x] = add(ram[SprObject_Y_MoveForce + x], ram[0x00]);
  const spd = adc(ram[SprObject_Y_Speed + x], 0x00);
  ram[SprObject_Y_Speed + x] = spd;
  if (!neg((spd - ram[0x02]) & 0xff)) {
    if (ram[SprObject_Y_MoveForce + x] >= 0x80) {
      ram[SprObject_Y_Speed + x] = ram[0x02];
      ram[SprObject_Y_MoveForce + x] = 0x00;
    }
  }
  if (!up) return;
  const m = twos(ram[0x02]);
  ram[0x07] = m;
  ram[SprObject_Y_MoveForce + x] = sub(ram[SprObject_Y_MoveForce + x], ram[0x01]);
  const s2 = sbc(ram[SprObject_Y_Speed + x], 0x00);
  ram[SprObject_Y_Speed + x] = s2;
  if (!neg((s2 - m) & 0xff)) return;
  if (ram[SprObject_Y_MoveForce + x] >= 0x80) return;
  ram[SprObject_Y_Speed + x] = m;
  ram[SprObject_Y_MoveForce + x] = 0xff;
}
