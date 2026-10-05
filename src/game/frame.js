// Frame driver, operating modes, screen/status-bar routines.
// Port of the top portion of the original program (NMI handler through
// PlayerLoseLife / game over handling). Routine names follow the disassembly.
'use strict';

// joypad state written by input.js each frame (bit layout: A B Sel St U D L R)
const Joypad = { p1: 0, p2: 0 };

function PowerOn() {
  ram.fill(0);
  Start(0xfe);
}

// Reset button. Like the original Start routine, keeps the top score (and the
// rest of $07d7-$07ff) when it still holds valid data.
function WarmBoot() {
  let y = 0xd6;
  for (let x = 5; x >= 0; x--) if (ram[TopScoreDisplay + x] >= 10) y = 0xfe;
  if (ram[WarmBootValidation] !== 0xa5) y = 0xfe;
  Start(y);
}

function Start(y) {
  // InitializeMemory: clear $0000-$07ff up to offset y in page 7, skipping $0160-$01ff
  ram.fill(0, 0x700, 0x700 + y + 1);
  ram.fill(0, 0x200, 0x700);
  ram.fill(0, 0x000, 0x160);
  C = 0;
  Music.eventRemaining = 0;
  Music.fast = false;
  PPU.nt.fill(0);
  PPU.pal.fill(0x0f);
  PPU.oam.fill(0xf8);
  ram[OperMode] = 0;
  ram[WarmBootValidation] = 0xa5;
  ram[PseudoRandomBitReg] = 0xa5;
  ram[Mirror_PPU_CTRL_REG2] = 0x06;
  MoveAllSpritesOffscreen();
  InitializeNameTables();
  ram[DisableScreenFlag]++;
  ram[Mirror_PPU_CTRL_REG1] |= 0x80;
}

function vramSource(ctrl) {
  switch (ctrl) {
    case 0x00: return (i) => ram[(VRAM_Buffer1 + i) & 0x7ff];
    case 0x05: return (i) => ram[(VRAM_Buffer1_Offset + i) & 0x7ff];
    case 0x06:
    case 0x07: return (i) => ram[(VRAM_Buffer2 + i) & 0x7ff];
    default: {
      const names = [null, 'WaterPaletteData', 'GroundPaletteData', 'UndergroundPaletteData',
        'CastlePaletteData', null, null, null, 'BowserPaletteData', 'DaySnowPaletteData',
        'NightSnowPaletteData', 'MushroomPaletteData', 'MarioThanksMessage', 'LuigiThanksMessage',
        'MushroomRetainerSaved', 'PrincessSaved1', 'PrincessSaved2', 'WorldSelectMessage1',
        'WorldSelectMessage2'];
      const base = L[names[ctrl]];
      if (base === undefined) return () => 0;
      return (i) => ROM[base + i];
    }
  }
}

// One video frame: everything the original NMI handler does.
function NonMaskableInterrupt() {
  ram[Mirror_PPU_CTRL_REG1] &= 0x7f;
  let m2 = ram[Mirror_PPU_CTRL_REG2] & 0xe6;
  if (!ram[DisableScreenFlag]) m2 = ram[Mirror_PPU_CTRL_REG2] | 0x1e;
  ram[Mirror_PPU_CTRL_REG2] = m2;
  PPU.frame.enabled = (m2 & 0x18) !== 0;
  // sprite DMA from $0200
  PPU.oam.set(ram.subarray(0x200, 0x300));
  // update screen with buffer contents
  const ctrl = ram[VRAM_Buffer_AddrCtrl];
  ppuProcessBuffer(vramSource(ctrl));
  const ofs = ROM[L.VRAM_Buffer_Offset + (ctrl === 0x06 ? 1 : 0)];
  ram[VRAM_Buffer1_Offset + ofs] = 0;
  ram[VRAM_Buffer1 + ofs] = 0;
  ram[VRAM_Buffer_AddrCtrl] = 0;
  SoundEngine();
  ReadJoypads();
  PauseRoutine();
  UpdateTopScore();
  if (!(ram[GamePauseStatus] & 1)) {
    let doTimers = true;
    if (ram[TimerControl] !== 0) {
      if (decRam(TimerControl) !== 0) doTimers = false;
    }
    if (doTimers) {
      let x = 0x14;
      decRam(IntervalTimerControl);
      if (neg(ram[IntervalTimerControl])) {
        ram[IntervalTimerControl] = 0x14;
        x = 0x23;
      }
      for (; x >= 0; x--) {
        if (ram[Timers + x]) ram[Timers + x]--;
      }
    }
    incRam(FrameCounter);
  }
  // pseudorandom bit register
  {
    const a = (ram[PseudoRandomBitReg] & 2) ^ (ram[PseudoRandomBitReg + 1] & 2);
    C = a ? 1 : 0;
    for (let x = 0; x < 7; x++) ram[PseudoRandomBitReg + x] = ror(ram[PseudoRandomBitReg + x]);
  }
  if (ram[Sprite0HitDetectFlag]) {
    if (!(ram[GamePauseStatus] & 1)) {
      MoveSpritesOffscreen();
      SpriteShuffler();
    }
  }
  PPU.frame.scrollX = ram[HorizontalScroll];
  PPU.frame.ntSelect = ram[Mirror_PPU_CTRL_REG1] & 1;
  PPU.frame.split = ram[Sprite0HitDetectFlag] !== 0;
  if (!(ram[GamePauseStatus] & 1)) OperModeExecutionTree();
}

// -------------------------------------------------------------------------------------

function PauseRoutine() {
  const mode = ram[OperMode];
  if (mode !== VictoryModeValue) {
    if (mode !== GameModeValue) return;
    if (ram[OperMode_Task] !== 3) return;
  }
  if (ram[GamePauseTimer]) {
    ram[GamePauseTimer]--;
    return;
  }
  if (ram[SavedJoypad1Bits] & Start_Button) {
    if (ram[GamePauseStatus] & 0x80) return;
    ram[GamePauseTimer] = 0x2b;
    const a = ram[GamePauseStatus];
    ram[PauseSoundQueue] = (a + 1) & 0xff;
    ram[GamePauseStatus] = (a ^ 1) | 0x80;
  } else {
    ram[GamePauseStatus] &= 0x7f;
  }
}

function SpriteShuffler() {
  const preset = 0x28;
  for (let x = 0x0e; x >= 0; x--) {
    let a = ram[SprDataOffset + x];
    if (a < preset) continue;
    const y = ram[SprShuffleAmtOffset];
    C = 0;
    a = adc(a, ram[SprShuffleAmt + y]);
    if (C) {
      C = 0;
      a = adc(a, preset);
    }
    ram[SprDataOffset + x] = a;
  }
  let x = ram[SprShuffleAmtOffset] + 1;
  if (x === 3) x = 0;
  ram[SprShuffleAmtOffset] = x;
  for (let y = 2, xx = 8; y >= 0; y--, xx -= 3) {
    const a = ram[SprDataOffset + 5 + y];
    ram[Misc_SprDataOffset - 2 + xx] = a;
    ram[Misc_SprDataOffset - 1 + xx] = (a + 8) & 0xff;
    ram[Misc_SprDataOffset + xx] = (a + 16) & 0xff;
  }
}

function OperModeExecutionTree() {
  switch (ram[OperMode]) {
    case 0: TitleScreenMode(); break;
    case 1: GameMode(); break;
    case 2: VictoryMode(); break;
    case 3: GameOverMode(); break;
  }
}

function MoveAllSpritesOffscreen() {
  for (let y = 0; y < 256; y += 4) ram[Sprite_Y_Position + y] = 0xf8;
}
function MoveSpritesOffscreen() {
  for (let y = 4; y < 256; y += 4) ram[Sprite_Y_Position + y] = 0xf8;
}

// -------------------------------------------------------------------------------------

function TitleScreenMode() {
  switch (ram[OperMode_Task]) {
    case 0: InitializeGame(); break;
    case 1: ScreenRoutines(); break;
    case 2: PrimaryGameSetup(); break;
    case 3: GameMenuRoutine(); break;
  }
}

function GameMenuRoutine() {
  let y = 0;
  const a = ram[SavedJoypad1Bits] | ram[SavedJoypad2Bits];
  if (a === Start_Button || a === A_Button + Start_Button) {
    ChkContinue(a);
    return;
  }
  let selectLogic = false;
  if (a === Select_Button) {
    selectLogic = true;
  } else if (ram[DemoTimer] === 0) {
    ram[SelectTimer] = a;
    if (DemoEngine()) {
      ResetTitle();
      return;
    }
    RunDemo();
    return;
  } else if (ram[WorldSelectEnableFlag] && a === B_Button) {
    y = 1;
    selectLogic = true;
  }
  if (selectLogic) {
    if (ram[DemoTimer] === 0) {
      ResetTitle();
      return;
    }
    ram[DemoTimer] = 0x18;
    if (ram[SelectTimer] === 0) {
      ram[SelectTimer] = 0x10;
      if (y === 1) {
        // IncWorldSel
        const w = (ram[WorldSelectNumber] + 1) & 7;
        ram[WorldSelectNumber] = w;
        GoContinue(w);
        // UpdateShroom: X is 0 after GoContinue
        for (let x = 0; x < 6; x++) ram[VRAM_Buffer1 - 1 + x] = ROM[L.WSelectBufferTemplate + x];
        ram[VRAM_Buffer1 + 3] = (ram[WorldNumber] + 1) & 0xff;
      } else {
        ram[NumberOfPlayers] ^= 1;
        DrawMushroomIcon();
      }
    }
  }
  // NullJoypad
  ram[SavedJoypad1Bits] = 0;
  RunDemo();
}

function RunDemo() {
  GameCoreRoutine();
  if (ram[GameEngineSubroutine] === 0x06) ResetTitle();
}

function ResetTitle() {
  ram[OperMode] = 0;
  ram[OperMode_Task] = 0;
  ram[Sprite0HitDetectFlag] = 0;
  ram[DisableScreenFlag]++;
}

function ChkContinue(a) {
  if (ram[DemoTimer] === 0) {
    ResetTitle();
    return;
  }
  if (a & A_Button) GoContinue(ram[ContinueWorld]);
  LoadAreaPointer();
  ram[Hidden1UpFlag]++;
  ram[OffScr_Hidden1UpFlag]++;
  ram[FetchNewGameTimerFlag]++;
  ram[OperMode]++;
  ram[PrimaryHardMode] = ram[WorldSelectEnableFlag];
  ram[OperMode_Task] = 0;
  ram[DemoTimer] = 0;
  for (let x = 0x17; x >= 0; x--) ram[ScoreAndCoinDisplay + x] = 0;
}

function GoContinue(a) {
  ram[WorldNumber] = a;
  ram[OffScr_WorldNumber] = a;
  ram[AreaNumber] = 0;
  ram[OffScr_AreaNumber] = 0;
}

function DrawMushroomIcon() {
  for (let y = 7; y >= 0; y--) ram[VRAM_Buffer1 - 1 + y] = ROM[L.MushroomIconData + y];
  if (ram[NumberOfPlayers]) {
    ram[VRAM_Buffer1 + 3] = 0x24;
    ram[VRAM_Buffer1 + 5] = 0xce;
  }
}

// returns true (carry set) when the demo is over
function DemoEngine() {
  let x = ram[DemoAction];
  if (ram[DemoActionTimer] === 0) {
    x++;
    ram[DemoAction]++;
    const t = ROM[L.DemoTimingData - 1 + x];
    ram[DemoActionTimer] = t;
    if (t === 0) return true;
  }
  ram[SavedJoypad1Bits] = ROM[L.DemoActionData - 1 + x];
  ram[DemoActionTimer]--;
  return false;
}

// -------------------------------------------------------------------------------------

function VictoryMode() {
  VictoryModeSubroutines();
  if (ram[OperMode_Task] !== 0) {
    ram[ObjectOffset] = 0;
    EnemiesAndLoopsCore(0);
  }
  RelativePlayerPosition();
  PlayerGfxHandler();
}

function VictoryModeSubroutines() {
  switch (ram[OperMode_Task]) {
    case 0: BridgeCollapse(); break;
    case 1: SetupVictoryMode(); break;
    case 2: PlayerVictoryWalk(); break;
    case 3: PrintVictoryMessages(); break;
    case 4: PlayerEndWorld(); break;
  }
}

function SetupVictoryMode() {
  ram[DestinationPageLoc] = (ram[ScreenRight_PageLoc] + 1) & 0xff;
  ram[EventMusicQueue] = EndOfCastleMusic;
  IncModeTask_B();
}

function PlayerVictoryWalk() {
  let y = 0;
  ram[VictoryWalkControl] = 0;
  if (ram[Player_PageLoc] !== ram[DestinationPageLoc] || ram[Player_X_Position] < 0x60) {
    ram[VictoryWalkControl]++;
    y++;
  }
  AutoControlPlayer(y);
  if (ram[ScreenLeft_PageLoc] !== ram[DestinationPageLoc]) {
    C = 0;
    ram[ScrollFractional] = adc(ram[ScrollFractional], 0x80);
    const amt = adc(1, 0);
    ScrollScreen(amt);
    UpdScrollVar();
    ram[VictoryWalkControl]++;
  }
  if (ram[VictoryWalkControl] === 0) IncModeTask_A();
}

function PrintVictoryMessages() {
  let gotoInc = false;
  let y;
  if (ram[SecondaryMsgCounter] !== 0) {
    gotoInc = true;
  } else {
    let a = ram[PrimaryMsgCounter];
    let thank = false;
    if (a === 0) {
      thank = true;
    } else if (a >= 0x09) {
      gotoInc = true;
    } else if (ram[WorldNumber] === World8) {
      if (a < 0x03) gotoInc = true;
      else {
        a = (a - 1) & 0xff;
        thank = true;
      }
    } else {
      if (a < 0x02) gotoInc = true;
      else thank = true;
    }
    if (thank) {
      // ThankPlayer
      y = a;
      let evalMusic = false;
      if (y === 0) {
        if (ram[CurrentPlayer] !== 0) y++;
        evalMusic = true;
      } else {
        // SecondPartMsg
        y++;
        if (ram[WorldNumber] === World8) {
          evalMusic = true;
        } else {
          y--;
          if (y >= 0x04) {
            // SetEndTimer with carry set
            ram[WorldEndTimer] = 0x06;
            IncModeTask_A();
            return;
          }
          if (y >= 0x03) gotoInc = true;
          else evalMusic = true;
        }
      }
      if (evalMusic) {
        if (y === 0x03) ram[EventMusicQueue] = VictoryMusic;
        ram[VRAM_Buffer_AddrCtrl] = (y + 0x0c) & 0xff;
        gotoInc = true;
      }
    }
  }
  if (gotoInc) {
    // IncMsgCounter
    C = 0;
    ram[SecondaryMsgCounter] = adc(ram[SecondaryMsgCounter], 0x04);
    ram[PrimaryMsgCounter] = adc(ram[PrimaryMsgCounter], 0x00);
    if (ram[PrimaryMsgCounter] >= 0x07) {
      ram[WorldEndTimer] = 0x06;
      IncModeTask_A();
    }
  }
}

function IncModeTask_A() {
  ram[OperMode_Task]++;
}

function PlayerEndWorld() {
  if (ram[WorldEndTimer] !== 0) return;
  if (ram[WorldNumber] >= World8) {
    // EndChkBButton
    if ((ram[SavedJoypad1Bits] | ram[SavedJoypad2Bits]) & B_Button) {
      ram[WorldSelectEnableFlag] = 1;
      ram[NumberofLives] = 0xff;
      TerminateGame();
    }
    return;
  }
  ram[AreaNumber] = 0;
  ram[LevelNumber] = 0;
  ram[OperMode_Task] = 0;
  ram[WorldNumber]++;
  LoadAreaPointer();
  ram[FetchNewGameTimerFlag]++;
  ram[OperMode] = GameModeValue;
}

// -------------------------------------------------------------------------------------

function FloateyNumbersRoutine(x) {
  let ctrl = ram[FloateyNum_Control + x];
  if (ctrl === 0) return;
  if (ctrl >= 0x0b) {
    ctrl = 0x0b;
    ram[FloateyNum_Control + x] = 0x0b;
  }
  const y0 = ctrl;
  if (ram[FloateyNum_Timer + x] === 0) {
    ram[FloateyNum_Control + x] = 0;
    return;
  }
  ram[FloateyNum_Timer + x]--;
  if (ram[FloateyNum_Timer + x] + 1 === 0x2b) {
    // timer was $2b before decrement
    if (y0 === 0x0b) {
      ram[NumberofLives]++;
      ram[Square2SoundQueue] = Sfx_ExtraLife;
    }
    const sd = ROM[L.ScoreUpdateData + y0];
    ram[DigitModifier + (sd >> 4)] = sd & 0x0f;
    AddToScore();
  }
  // ChkTallEnemy
  let y = ram[Enemy_SprDataOffset + x];
  const id = ram[Enemy_ID + x];
  let alt = false;
  if (id === Spiny || id === PiranhaPlant || id === GreyCheepCheep || id === RedCheepCheep) {
    alt = false;
  } else if (id === HammerBro) {
    alt = true;
  } else if (id >= TallEnemy) {
    alt = true;
  } else if (ram[Enemy_State + x] >= 0x02) {
    alt = false;
  } else {
    alt = true;
  }
  if (alt) {
    y = ram[Alt_SprDataOffset + ram[SprDataOffset_Ctrl]];
  }
  // FloateyPart
  let fy = ram[FloateyNum_Y_Pos + x];
  if (fy >= 0x18) {
    fy = (fy - 1) & 0xff;
    ram[FloateyNum_Y_Pos + x] = fy;
    C = 1;
  } else {
    C = 0;
  }
  // SetupNumSpr: SBC #$08 with carry from the compare above
  const sy = sbc(ram[FloateyNum_Y_Pos + x], 0x08);
  DumpTwoSpr(sy, y);
  const fx = ram[FloateyNum_X_Pos + x];
  ram[Sprite_X_Position + y] = fx;
  ram[Sprite_X_Position + 4 + y] = (fx + 8) & 0xff;
  ram[Sprite_Attributes + y] = 0x02;
  ram[Sprite_Attributes + 4 + y] = 0x02;
  const c2 = ram[FloateyNum_Control + x] * 2;
  ram[Sprite_Tilenumber + y] = ROM[L.FloateyNumTileData + c2];
  ram[Sprite_Tilenumber + 4 + y] = ROM[L.FloateyNumTileData + c2 + 1];
}

// -------------------------------------------------------------------------------------

function ScreenRoutines() {
  switch (ram[ScreenRoutineTask]) {
    case 0: InitScreen(); break;
    case 1: SetupIntermediate(); break;
    case 2: WriteTopStatusLine(); break;
    case 3: WriteBottomStatusLine(); break;
    case 4: DisplayTimeUp(); break;
    case 5: ResetSpritesAndScreenTimer(); break;
    case 6: DisplayIntermediate(); break;
    case 7: ResetSpritesAndScreenTimer(); break;
    case 8: AreaParserTaskControl(); break;
    case 9: GetAreaPalette(); break;
    case 10: GetBackgroundColor(); break;
    case 11: GetAlternatePalette1(); break;
    case 12: DrawTitleScreen(); break;
    case 13: ClearBuffersDrawIcon(); break;
    case 14: WriteTopScore(); break;
  }
}

function InitScreen() {
  MoveAllSpritesOffscreen();
  InitializeNameTables();
  if (ram[OperMode] !== 0) {
    ram[VRAM_Buffer_AddrCtrl] = 0x03;
  }
  IncSubtask();
}

function SetupIntermediate() {
  const bg = ram[BackgroundColorCtrl];
  const st = ram[PlayerStatus];
  ram[PlayerStatus] = 0;
  ram[BackgroundColorCtrl] = 0x02;
  GetPlayerColors();
  ram[PlayerStatus] = st;
  ram[BackgroundColorCtrl] = bg;
  IncSubtask();
}

function GetAreaPalette() {
  ram[VRAM_Buffer_AddrCtrl] = ROM[L.AreaPalette + ram[AreaType]];
  IncSubtask();
}

function GetBackgroundColor() {
  const y = ram[BackgroundColorCtrl];
  if (y) ram[VRAM_Buffer_AddrCtrl] = ROM[L.BGColorCtrl_Addr - 4 + y];
  ram[ScreenRoutineTask]++;
  GetPlayerColors();
}

function GetPlayerColors() {
  let x = ram[VRAM_Buffer1_Offset];
  let y = 0;
  if (ram[CurrentPlayer]) y = 4;
  if (ram[PlayerStatus] === 2) y = 8;
  for (let n = 0; n < 4; n++) {
    ram[VRAM_Buffer1 + 3 + x + n] = ROM[L.PlayerColors + y + n];
  }
  x = ram[VRAM_Buffer1_Offset];
  let by = ram[BackgroundColorCtrl];
  if (!by) by = ram[AreaType];
  ram[VRAM_Buffer1 + 3 + x] = ROM[L.BackgroundColors + by];
  ram[VRAM_Buffer1 + x] = 0x3f;
  ram[VRAM_Buffer1 + 1 + x] = 0x10;
  ram[VRAM_Buffer1 + 2 + x] = 0x04;
  ram[VRAM_Buffer1 + 7 + x] = 0x00;
  ram[VRAM_Buffer1_Offset] = (x + 7) & 0xff;
  return x; // X register on exit
}

function GetAlternatePalette1() {
  if (ram[AreaStyle] === 0x01) ram[VRAM_Buffer_AddrCtrl] = 0x0b;
  IncSubtask();
}

function WriteTopStatusLine() {
  WriteGameText(0);
  IncSubtask();
}

function WriteBottomStatusLine() {
  GetSBNybbles();
  const x = ram[VRAM_Buffer1_Offset];
  ram[VRAM_Buffer1 + x] = 0x20;
  ram[VRAM_Buffer1 + 1 + x] = 0x73;
  ram[VRAM_Buffer1 + 2 + x] = 0x03;
  ram[VRAM_Buffer1 + 3 + x] = (ram[WorldNumber] + 1) & 0xff;
  ram[VRAM_Buffer1 + 4 + x] = 0x28;
  ram[VRAM_Buffer1 + 5 + x] = (ram[LevelNumber] + 1) & 0xff;
  ram[VRAM_Buffer1 + 6 + x] = 0x00;
  ram[VRAM_Buffer1_Offset] = (x + 6) & 0xff;
  IncSubtask();
}

function DisplayTimeUp() {
  if (ram[GameTimerExpiredFlag]) {
    ram[GameTimerExpiredFlag] = 0;
    OutputInter(0x02);
    return;
  }
  ram[ScreenRoutineTask]++;
  IncSubtask();
}

function DisplayIntermediate() {
  const mode = ram[OperMode];
  if (mode !== 0) {
    if (mode === GameOverModeValue) {
      ram[ScreenTimer] = 0x12;
      WriteGameText(0x03);
      IncModeTask_B();
      return;
    }
    if (ram[AltEntranceControl] === 0) {
      if (ram[AreaType] === 0x03 || ram[DisableIntermediate] === 0) {
        DrawPlayer_Intermediate();
        OutputInter(0x01);
        return;
      }
    }
  }
  // NoInter
  ram[ScreenRoutineTask] = 0x08;
}

function OutputInter(a) {
  WriteGameText(a);
  ResetScreenTimer();
  ram[DisableScreenFlag] = 0;
}

function AreaParserTaskControl() {
  ram[DisableScreenFlag]++;
  do {
    AreaParserTaskHandler();
  } while (ram[AreaParserTaskNum] !== 0);
  decRam(ColumnSets);
  if (neg(ram[ColumnSets])) ram[ScreenRoutineTask]++;
  ram[VRAM_Buffer_AddrCtrl] = 0x06;
}

function DrawTitleScreen() {
  if (ram[OperMode] !== 0) {
    IncModeTask_B();
    return;
  }
  // The original copies a nametable image stored in CHR-ROM into $0300.
  // This port supplies its own title-screen layout (see src/gfx/title.js).
  const data = TITLE_SCREEN_DATA;
  for (let i = 0; i < data.length && 0x300 + i < 0x800; i++) ram[0x300 + i] = data[i];
  ram[VRAM_Buffer_AddrCtrl] = 0x05;
  IncSubtask();
}

function ClearBuffersDrawIcon() {
  if (ram[OperMode] !== 0) {
    IncModeTask_B();
    return;
  }
  for (let x = 0; x < 0x100; x++) {
    ram[VRAM_Buffer1 - 1 + x] = 0;
    ram[VRAM_Buffer1 - 1 + 0x100 + x] = 0;
  }
  DrawMushroomIcon();
  IncSubtask();
}

function IncSubtask() {
  ram[ScreenRoutineTask]++;
}

function WriteTopScore() {
  UpdateNumber(0xfa);
  IncModeTask_B();
}

function IncModeTask_B() {
  ram[OperMode_Task]++;
}

function WriteGameText(num) {
  let y = num * 2;
  if (y >= 0x04) {
    if (y >= 0x08) y = 0x08;
    if (ram[NumberOfPlayers] === 0) y++;
  }
  let x = ROM[L.GameTextOffsets + y];
  let i = 0;
  for (;;) {
    const a = ROM[L.GameText + x];
    if (a === 0xff) break;
    ram[VRAM_Buffer1 + i] = a;
    x++;
    i++;
    if (i > 0xff) break;
  }
  ram[VRAM_Buffer1 + i] = 0;
  if (num >= 0x04) {
    PrintWarpZoneNumbers(num);
    return;
  }
  if (num - 1 !== 0) {
    CheckPlayerName(num - 1);
    return;
  }
  let lives = (ram[NumberofLives] + 1) & 0xff;
  if (lives >= 10) {
    lives -= 10;
    ram[VRAM_Buffer1 + 7] = 0x9f;
  }
  ram[VRAM_Buffer1 + 8] = lives;
  ram[VRAM_Buffer1 + 19] = (ram[WorldNumber] + 1) & 0xff;
  ram[VRAM_Buffer1 + 21] = (ram[LevelNumber] + 1) & 0xff;
}

function CheckPlayerName(xAfterDex) {
  if (ram[NumberOfPlayers] === 0) return;
  let a = ram[CurrentPlayer];
  // X was decremented once before; decrement again for time-up check
  if (xAfterDex - 1 === 0) {
    if (ram[OperMode] !== GameOverModeValue) a ^= 1;
  }
  if (!(a & 1)) return;
  for (let y = 4; y >= 0; y--) ram[VRAM_Buffer1 + 3 + y] = ROM[L.LuigiName + y];
}

function PrintWarpZoneNumbers(num) {
  let x = (num - 4) * 4;
  for (let y = 0; y < 0x0c; y += 4) {
    ram[VRAM_Buffer1 + 27 + y] = ROM[L.WarpZoneNumbers + x];
    x++;
  }
  ram[VRAM_Buffer1_Offset] = 0x2c;
}

function ResetSpritesAndScreenTimer() {
  if (ram[ScreenTimer]) return;
  MoveAllSpritesOffscreen();
  ResetScreenTimer();
}
function ResetScreenTimer() {
  ram[ScreenTimer] = 0x07;
  ram[ScreenRoutineTask]++;
}

// -------------------------------------------------------------------------------------

function RenderAreaGraphics() {
  const lsbCol = ram[CurrentColumnPos] & 0x01; // $05
  const y0 = ram[VRAM_Buffer2_Offset];
  let vofs = y0; // $00
  ram[VRAM_Buffer2 + 1 + y0] = ram[CurrentNTAddr_Low];
  ram[VRAM_Buffer2 + y0] = ram[CurrentNTAddr_High];
  ram[VRAM_Buffer2 + 2 + y0] = 0x9a;
  for (let x = 0; x < 0x0d; x++) {
    const mt = ram[MetatileBuffer + x];
    const palSel = mt >> 6;
    const tableBase = [L.Palette0_MTiles, L.Palette1_MTiles, L.Palette2_MTiles, L.Palette3_MTiles][palSel];
    // tile column within metatile: left when task number is odd
    const tofs = ((mt << 2) & 0xff) + (((ram[AreaParserTaskNum] & 1) ^ 1) << 1);
    ram[VRAM_Buffer2 + 3 + vofs] = ROM[tableBase + (tofs & 0xff)];
    ram[VRAM_Buffer2 + 4 + vofs] = ROM[tableBase + ((tofs + 1) & 0xff)];
    // attribute quadrant: upper-left d1-d0, upper-right d3-d2, lower-left d5-d4, lower-right d7-d6
    const shift = ((x & 1) ? 4 : 0) + (lsbCol ? 2 : 0);
    ram[AttributeBuffer + (x >> 1)] |= (palSel << shift);
    vofs = (vofs + 2) & 0xff;
  }
  const y = (vofs + 3) & 0xff;
  ram[VRAM_Buffer2 + y] = 0x00;
  ram[VRAM_Buffer2_Offset] = y;
  ram[CurrentNTAddr_Low] = (ram[CurrentNTAddr_Low] + 1) & 0xff;
  if ((ram[CurrentNTAddr_Low] & 0x1f) === 0) {
    ram[CurrentNTAddr_Low] = 0x80;
    ram[CurrentNTAddr_High] ^= 0x04;
  }
  ram[VRAM_Buffer_AddrCtrl] = 0x06;
}

function RenderAttributeTables() {
  C = 1;
  let lo = sbc(ram[CurrentNTAddr_Low] & 0x1f, 0x04) & 0x1f;
  let hi = ram[CurrentNTAddr_High];
  if (!C) hi ^= 0x04;
  hi = (hi & 0x04) | 0x23;
  // LSR; LSR; ADC #$c0 (carry from last LSR)
  lo = lsr(lsr(lo));
  lo = adc(lo, 0xc0);
  let y = ram[VRAM_Buffer2_Offset];
  for (let x = 0; x < 7; x++) {
    ram[VRAM_Buffer2 + y] = hi;
    lo = (lo + 8) & 0xff;
    ram[VRAM_Buffer2 + 1 + y] = lo;
    ram[VRAM_Buffer2 + 3 + y] = ram[AttributeBuffer + x];
    ram[VRAM_Buffer2 + 2 + y] = 0x01;
    ram[AttributeBuffer + x] = 0;
    y += 4;
  }
  ram[VRAM_Buffer2 + y] = 0;
  ram[VRAM_Buffer2_Offset] = y & 0xff;
  ram[VRAM_Buffer_AddrCtrl] = 0x06;
}

// -------------------------------------------------------------------------------------

function ColorRotation() {
  if (ram[FrameCounter] & 0x07) return;
  let x = ram[VRAM_Buffer1_Offset];
  if (x >= 0x31) return;
  for (let y = 0; y < 8; y++) ram[VRAM_Buffer1 + x + y] = ROM[L.BlankPalette + y];
  x = ram[VRAM_Buffer1_Offset];
  const ay = ram[AreaType] * 4;
  for (let n = 0; n < 4; n++) ram[VRAM_Buffer1 + 3 + x + n] = ROM[L.Palette3Data + ay + n];
  ram[VRAM_Buffer1 + 4 + x] = ROM[L.ColorRotatePalette + ram[ColorRotateOffset]];
  ram[VRAM_Buffer1_Offset] = (x + 7) & 0xff;
  ram[ColorRotateOffset]++;
  if (ram[ColorRotateOffset] >= 0x06) ram[ColorRotateOffset] = 0;
}

// -------------------------------------------------------------------------------------

function RemoveCoin_Axe() {
  const a = ram[AreaType] ? 0x03 : 0x04;
  PutBlockMetatile(a, 0x41, ram[ObjectOffset]);
  ram[VRAM_Buffer_AddrCtrl] = 0x06;
}

function ReplaceBlockMetatile(a, x) {
  WriteBlockMetatile(a, x);
  ram[Block_ResidualCounter]++;
  ram[Block_RepFlag + x] = (ram[Block_RepFlag + x] - 1) & 0xff;
}

function DestroyBlockMetatile(x) {
  WriteBlockMetatile(0, x);
}

function WriteBlockMetatile(a, x) {
  let y;
  if (a === 0) y = 0x03;
  else if (a === 0x58 || a === 0x51) y = 0x00;
  else if (a === 0x5d || a === 0x52) y = 0x01;
  else y = 0x02;
  let vy = (ram[VRAM_Buffer1_Offset] + 1) & 0xff;
  vy = PutBlockMetatile(y, vy, x);
  MoveVOffset(vy);
}

function MoveVOffset(y) {
  ram[VRAM_Buffer1_Offset] = (y - 1 + 10) & 0xff;
}

// writes a 2x2 tile block into VRAM_Buffer1 at offset y; uses $02 and $06 from the
// block buffer routines. Returns the buffer offset used.
function PutBlockMetatile(a, y, x) {
  ram[0x00] = x;
  ram[0x01] = y;
  const gx = (a * 4) & 0xff;
  let ntHigh = 0x20;
  if (ram[0x06] >= 0xd0) ntHigh = 0x24;
  ram[0x03] = ntHigh;
  ram[0x04] = ((ram[0x06] & 0x0f) << 1) & 0xff;
  ram[0x05] = 0;
  let v = (ram[0x02] + 0x20) & 0xff;
  // v * 4 as 16 bits
  const word = v * 4 + ram[0x04];
  ram[0x04] = word & 0xff;
  ram[0x05] = ((word >> 8) + ntHigh) & 0xff;
  RemBridge(gx, ram[0x01]);
  return ram[0x01];
}

function RemBridge(x, y) {
  ram[VRAM_Buffer1 + 2 + y] = ROM[L.BlockGfxData + x];
  ram[VRAM_Buffer1 + 3 + y] = ROM[L.BlockGfxData + x + 1];
  ram[VRAM_Buffer1 + 7 + y] = ROM[L.BlockGfxData + x + 2];
  ram[VRAM_Buffer1 + 8 + y] = ROM[L.BlockGfxData + x + 3];
  ram[VRAM_Buffer1 + y] = ram[0x04];
  ram[VRAM_Buffer1 + 5 + y] = (ram[0x04] + 0x20) & 0xff;
  ram[VRAM_Buffer1 - 1 + y] = ram[0x05];
  ram[VRAM_Buffer1 + 4 + y] = ram[0x05];
  ram[VRAM_Buffer1 + 1 + y] = 0x02;
  ram[VRAM_Buffer1 + 6 + y] = 0x02;
  ram[VRAM_Buffer1 + 9 + y] = 0x00;
}

// -------------------------------------------------------------------------------------

function InitializeNameTables() {
  const m = ((ram[Mirror_PPU_CTRL_REG1] | 0x10) & 0xf0);
  ram[Mirror_PPU_CTRL_REG1] = m;
  ppuClearNametable(0x2400);
  ppuClearNametable(0x2000);
  ram[VRAM_Buffer1_Offset] = 0;
  ram[VRAM_Buffer1] = 0;
  ram[HorizontalScroll] = 0;
  ram[VerticalScroll] = 0;
}

function ReadJoypads() {
  const pads = [Joypad.p1, Joypad.p2];
  for (let x = 0; x < 2; x++) {
    const a = pads[x];
    ram[SavedJoypadBits + x] = a;
    if ((a & 0x30) & ram[JoypadBitMask + x]) {
      ram[SavedJoypadBits + x] = a & 0xcf;
    } else {
      ram[JoypadBitMask + x] = a;
    }
  }
}

// -------------------------------------------------------------------------------------

function PrintStatusBarNumbers(a) {
  ram[0x00] = a;
  OutputNumbers(a);
  OutputNumbers(ram[0x00] >> 4);
}

function OutputNumbers(a) {
  a = ((a + 1) & 0x0f);
  if (a >= 0x06) return;
  const y = a * 2;
  let x = ram[VRAM_Buffer1_Offset];
  ram[VRAM_Buffer1 + x] = y === 0 ? 0x22 : 0x20;
  ram[VRAM_Buffer1 + 1 + x] = ROM[L.StatusBarData + y];
  const len = ROM[L.StatusBarData + 1 + y];
  ram[VRAM_Buffer1 + 2 + x] = len;
  let dy = (ROM[L.StatusBarOffset + a] - len) & 0xff;
  for (let n = 0; n < len; n++) {
    ram[VRAM_Buffer1 + 3 + x] = ram[DisplayDigits + dy];
    x++;
    dy++;
  }
  ram[VRAM_Buffer1 + 3 + x] = 0;
  ram[VRAM_Buffer1_Offset] = (x + 3) & 0xff;
}

function DigitsMathRoutine(y) {
  if (ram[OperMode] !== TitleScreenModeValue) {
    for (let x = 5; x >= 0; x--) {
      let a = (ram[DigitModifier + x] + ram[DisplayDigits + y]) & 0xff;
      if (neg(a)) {
        ram[DigitModifier - 1 + x] = (ram[DigitModifier - 1 + x] - 1) & 0xff;
        a = 9;
      } else if (a >= 10) {
        a -= 10;
        ram[DigitModifier - 1 + x] = (ram[DigitModifier - 1 + x] + 1) & 0xff;
      }
      ram[DisplayDigits + y] = a;
      y--;
    }
  }
  for (let x = 6; x >= 0; x--) ram[DigitModifier - 1 + x] = 0;
}

function UpdateTopScore() {
  TopScoreCheck(0x05);
  TopScoreCheck(0x0b);
}

function TopScoreCheck(x) {
  C = 1;
  let y = 5;
  for (; y >= 0; y--, x--) sbc(ram[PlayerScoreDisplay + x], ram[TopScoreDisplay + y]);
  if (!C) return;
  x++;
  y++;
  for (; y < 6; x++, y++) ram[TopScoreDisplay + y] = ram[PlayerScoreDisplay + x];
}

// -------------------------------------------------------------------------------------

function InitializeGame() {
  InitializeMemory(0x6f);
  for (let y = 0x1f; y >= 0; y--) ram[SoundMemory + y] = 0;
  ram[DemoTimer] = 0x18;
  LoadAreaPointer();
  InitializeArea();
}

function InitializeArea() {
  InitializeMemory(0x4b);
  for (let x = 0x21; x >= 0; x--) ram[Timers + x] = 0;
  let a = ram[HalfwayPage];
  if (ram[AltEntranceControl]) a = ram[EntrancePage];
  ram[ScreenLeft_PageLoc] = a;
  ram[CurrentPageLoc] = a;
  ram[BackloadingFlag] = a;
  a = GetScreenPosition();
  ram[CurrentNTAddr_High] = (a & 1) ? 0x24 : 0x20;
  ram[CurrentNTAddr_Low] = 0x80;
  ram[BlockBufferColumnPos] = ((a & 1) << 4) & 0xff;
  decRam(AreaObjectLength);
  decRam(AreaObjectLength + 1);
  decRam(AreaObjectLength + 2);
  ram[ColumnSets] = 0x0b;
  GetAreaDataAddrs();
  let setSec = false;
  if (ram[PrimaryHardMode]) setSec = true;
  else if (ram[WorldNumber] >= World5) {
    if (ram[WorldNumber] !== World5) setSec = true;
    else if (ram[LevelNumber] >= Level3) setSec = true;
  }
  if (setSec) ram[SecondaryHardMode]++;
  if (ram[HalfwayPage]) ram[PlayerEntranceCtrl] = 0x02;
  ram[AreaMusicQueue] = Silence;
  ram[DisableScreenFlag] = 0x01;
  ram[OperMode_Task]++;
}

function PrimaryGameSetup() {
  ram[FetchNewGameTimerFlag] = 0x01;
  ram[PlayerSize] = 0x01;
  ram[NumberofLives] = 0x02;
  ram[OffScr_NumberofLives] = 0x02;
  SecondaryGameSetup();
}

function SecondaryGameSetup() {
  ram[DisableScreenFlag] = 0;
  for (let y = 0; y < 0x100; y++) ram[VRAM_Buffer1 - 1 + y] = 0;
  ram[GameTimerExpiredFlag] = 0;
  ram[DisableIntermediate] = 0;
  ram[BackloadingFlag] = 0;
  ram[BalPlatformAlignment] = 0xff;
  ram[Mirror_PPU_CTRL_REG1] = (ram[Mirror_PPU_CTRL_REG1] & 0xfe) | (ram[ScreenLeft_PageLoc] & 1);
  GetAreaMusic();
  ram[SprShuffleAmt + 2] = 0x38;
  ram[SprShuffleAmt + 1] = 0x48;
  ram[SprShuffleAmt] = 0x58;
  for (let x = 0x0e; x >= 0; x--) ram[SprDataOffset + x] = ROM[L.DefaultSprOffsets + x];
  for (let y = 3; y >= 0; y--) ram[Sprite_Data + y] = ROM[L.Sprite0Data + y];
  ram[0x06c9] = 0xff; // DoNothing1
  ram[Sprite0HitDetectFlag]++;
  ram[OperMode_Task]++;
}

// clears RAM from $07yy down to $0000, skipping $0160-$01ff (the stack)
function InitializeMemory(y) {
  for (let page = 7; page >= 0; page--) {
    const top = page === 7 ? y : 0xff;
    for (let b = top; b >= 0; b--) {
      if (page === 1 && b >= 0x60) continue;
      ram[(page << 8) | b] = 0;
    }
  }
  C = 1; // CPY #$ff leaves carry set
  return 0;
}

function GetAreaMusic() {
  if (ram[OperMode] === 0) return;
  let y;
  let chkArea = true;
  if (ram[AltEntranceControl] !== 0x02) {
    y = 0x05;
    const pe = ram[PlayerEntranceCtrl];
    if (pe === 0x06 || pe === 0x07) chkArea = false;
  }
  if (chkArea) {
    y = ram[AreaType];
    if (ram[CloudTypeOverride]) y = 0x04;
  }
  ram[AreaMusicQueue] = ROM[L.MusicSelectData + y];
}

function Entrance_GameTimerSetup() {
  ram[Player_PageLoc] = ram[ScreenLeft_PageLoc];
  ram[VerticalForceDown] = 0x28;
  ram[PlayerFacingDir] = 0x01;
  ram[Player_Y_HighPos] = 0x01;
  ram[Player_State] = 0x00;
  decRam(Player_CollisionBits);
  ram[HalfwayPage] = 0;
  ram[SwimmingFlag] = ram[AreaType] === 0 ? 1 : 0;
  let x = ram[PlayerEntranceCtrl];
  const y = ram[AltEntranceControl];
  if (y !== 0 && y !== 1) x = ROM[L.AltYPosOffset - 2 + y];
  ram[Player_X_Position] = ROM[L.PlayerStarting_X_Pos + y];
  ram[Player_Y_Position] = ROM[L.PlayerStarting_Y_Pos + x];
  ram[Player_SprAttrib] = ROM[L.PlayerBGPriorityData + x];
  x = GetPlayerColors();
  const gts = ram[GameTimerSetting];
  if (gts && ram[FetchNewGameTimerFlag]) {
    ram[GameTimerDisplay] = ROM[L.GameTimerData + gts];
    ram[GameTimerDisplay + 2] = 0x01;
    ram[GameTimerDisplay + 1] = 0x00;
    ram[FetchNewGameTimerFlag] = 0;
    ram[StarInvincibleTimer] = 0;
  }
  if (ram[JoypadOverride]) {
    ram[Player_State] = 0x03;
    InitBlock_XY_Pos(0);
    ram[Block_Y_Position] = 0xf0;
    Setup_Vine(0x05, 0x00);
    x = 0x05;
  }
  if (ram[AreaType] === 0) SetupBubble(x);
  ram[GameEngineSubroutine] = 0x07;
}

function PlayerLoseLife() {
  ram[DisableScreenFlag]++;
  ram[Sprite0HitDetectFlag] = 0;
  ram[EventMusicQueue] = Silence;
  decRam(NumberofLives);
  if (neg(ram[NumberofLives])) {
    ram[OperMode_Task] = 0;
    ram[OperMode] = GameOverModeValue;
    return;
  }
  let x = ram[WorldNumber] * 2;
  if (ram[LevelNumber] & 0x02) x++;
  let a = ROM[L.HalfwayPageNybbles + x];
  if (!(ram[LevelNumber] & 1)) a >>= 4;
  a &= 0x0f;
  if (!(a <= ram[ScreenLeft_PageLoc])) a = 0;
  ram[HalfwayPage] = a;
  TransposePlayers();
  ContinueGame();
}

function GameOverMode() {
  switch (ram[OperMode_Task]) {
    case 0: SetupGameOver(); break;
    case 1: ScreenRoutines(); break;
    case 2: RunGameOver(); break;
  }
}

function SetupGameOver() {
  ram[ScreenRoutineTask] = 0;
  ram[Sprite0HitDetectFlag] = 0;
  ram[EventMusicQueue] = GameOverMusic;
  ram[DisableScreenFlag]++;
  ram[OperMode_Task]++;
}

function RunGameOver() {
  ram[DisableScreenFlag] = 0;
  if (!(ram[SavedJoypad1Bits] & Start_Button)) {
    if (ram[ScreenTimer]) return;
  }
  TerminateGame();
}

function TerminateGame() {
  ram[EventMusicQueue] = Silence;
  if (!TransposePlayers()) {
    ContinueGame();
    return;
  }
  ram[ContinueWorld] = ram[WorldNumber];
  ram[OperMode_Task] = 0;
  ram[ScreenTimer] = 0;
  ram[OperMode] = 0;
}

function ContinueGame() {
  LoadAreaPointer();
  ram[PlayerSize] = 0x01;
  ram[FetchNewGameTimerFlag]++;
  ram[TimerControl] = 0;
  ram[PlayerStatus] = 0;
  ram[GameEngineSubroutine] = 0;
  ram[OperMode_Task] = 0;
  ram[OperMode] = 0x01;
}

// returns true (carry set) if the game should end
function TransposePlayers() {
  if (ram[NumberOfPlayers] === 0) return true;
  if (neg(ram[OffScr_NumberofLives])) return true;
  ram[CurrentPlayer] ^= 1;
  for (let x = 6; x >= 0; x--) {
    const t = ram[OnscreenPlayerInfo + x];
    ram[OnscreenPlayerInfo + x] = ram[OffscreenPlayerInfo + x];
    ram[OffscreenPlayerInfo + x] = t;
  }
  return false;
}
