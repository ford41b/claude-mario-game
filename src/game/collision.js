// Collision handling: fireballs, hammers, player vs enemies, enemies vs
// enemies, platforms, player/enemy/fireball vs background, bounding boxes.
// Port of FireballEnemyCollision .. BlockBufferCollision.
'use strict';

function FireballEnemyCollision(x) {
  const st = ram[Fireball_State + x];
  if (st === 0 || (st & 0x80)) return;
  if (ram[FrameCounter] & 1) return;
  const y = ((x << 2) + 0x1c) & 0xff;
  for (let e = 4; e >= 0; e--) {
    ram[0x01] = e;
    if (ram[Enemy_State + e] & 0x20) continue;
    if (!ram[Enemy_Flag + e]) continue;
    const id = ram[Enemy_ID + e];
    if (id >= 0x24 && id < 0x2b) continue;
    if (id === Goomba && ram[Enemy_State + e] >= 0x02) continue;
    if (ram[EnemyOffscrBitsMasked + e]) continue;
    const hit = SprObjectCollisionCore(((e << 2) + 0x04) & 0xff, y);
    x = ram[ObjectOffset];
    if (!hit) continue;
    ram[Fireball_State + x] = 0x80;
    HandleEnemyFBallCol(ram[0x01]);
  }
}

function HandleEnemyFBallCol(x) {
  RelativeEnemyPosition(x);
  x = ram[0x01];
  let id;
  const f = ram[Enemy_Flag + x];
  if (neg(f)) {
    const b = f & 0x0f;
    if (ram[Enemy_ID + b] === Bowser) {
      HurtBowser(b);
      return;
    }
    x = ram[0x01];
  }
  id = ram[Enemy_ID + x];
  if (id === BuzzyBeetle) return;
  if (id === Bowser) {
    HurtBowser(x);
    return;
  }
  // ChkOtherEnemies
  if (id === BulletBill_FrenzyVar || id === Podoboo || id >= 0x15) return;
  ShellOrBlockDefeat(x);
}

function HurtBowser(x) {
  ram[BowserHitPoints]--;
  if (ram[BowserHitPoints] !== 0) return;
  InitVStf(x);
  ram[Enemy_X_Speed + x] = 0;
  ram[EnemyFrenzyBuffer] = 0;
  ram[Enemy_Y_Speed + x] = 0xfe;
  const w = ram[WorldNumber];
  ram[Enemy_ID + x] = ROM[L.BowserIdentities + w];
  let a = 0x20;
  if (w < 0x03) a |= 0x03;
  ram[Enemy_State + x] = a;
  ram[Square2SoundQueue] = Sfx_BowserFall;
  EnemySmackScore(ram[0x01], 0x09);
}

function ShellOrBlockDefeat(x) {
  let a = ram[Enemy_ID + x];
  if (a === PiranhaPlant) {
    C = 1;
    a = adc(ram[Enemy_Y_Position + x], 0x18);
    ram[Enemy_Y_Position + x] = a;
  }
  ChkToStunEnemies(x, a);
  ram[Enemy_State + x] = (ram[Enemy_State + x] & 0x1f) | 0x20;
  let pts = 0x02;
  const id = ram[Enemy_ID + x];
  if (id === HammerBro) pts = 0x06;
  if (id === Goomba) pts = 0x01;
  EnemySmackScore(x, pts);
}

function EnemySmackScore(x, a) {
  SetupFloateyNumber(x, a);
  ram[Square1SoundQueue] = Sfx_EnemySmack;
}

function PlayerHammerCollision(x) {
  if (!(ram[FrameCounter] & 1)) return;
  if (ram[TimerControl] | ram[Misc_OffscreenBits]) return;
  const y = ((x << 2) + 0x24) & 0xff;
  const hit = PlayerCollisionCore(y);
  x = ram[ObjectOffset];
  if (!hit) {
    ram[Misc_Collision_Flag + x] = 0;
    return;
  }
  if (ram[Misc_Collision_Flag + x]) return;
  ram[Misc_Collision_Flag + x] = 0x01;
  ram[Misc_X_Speed + x] = twos(ram[Misc_X_Speed + x]);
  if (ram[StarInvincibleTimer]) return;
  InjurePlayer();
}

function HandlePowerUpCollision(x) {
  EraseEnemyObject(x);
  SetupFloateyNumber(x, 0x06);
  ram[Square2SoundQueue] = Sfx_PowerUpGrab;
  const t = ram[PowerUpType];
  if (t < 0x02) {
    // Shroom_Flower_PUp
    const ps = ram[PlayerStatus];
    if (ps === 0) {
      ram[PlayerStatus] = 0x01;
      SetPRout(0x09, 0x00);
      return;
    }
    if (ps !== 0x01) return;
    ram[PlayerStatus] = 0x02;
    GetPlayerColors();
    SetPRout(0x0c, 0x00);
    return;
  }
  if (t === 0x03) {
    ram[FloateyNum_Control + x] = 0x0b;
    return;
  }
  ram[StarInvincibleTimer] = 0x23;
  ram[AreaMusicQueue] = StarPowerMusic;
}

function PlayerEnemyCollision(x) {
  if (ram[FrameCounter] & 1) return;
  if (CheckPlayerVertical()) return;
  if (ram[EnemyOffscrBitsMasked + x]) return;
  if (ram[GameEngineSubroutine] !== 0x08) return;
  if (ram[Enemy_State + x] & 0x20) return;
  const y = GetEnemyBoundBoxOfs();
  const hit = PlayerCollisionCore(y);
  x = ram[ObjectOffset];
  if (!hit) {
    ram[Enemy_CollisionBits + x] &= 0xfe;
    return;
  }
  // CheckForPUpCollision
  const id = ram[Enemy_ID + x];
  if (id === PowerUpObject) {
    HandlePowerUpCollision(x);
    return;
  }
  if (ram[StarInvincibleTimer]) {
    ShellOrBlockDefeat(x);
    return;
  }
  HandlePECollisions(x, id);
}

function HandlePECollisions(x, id) {
  if ((ram[Enemy_CollisionBits + x] & 0x01) | ram[EnemyOffscrBitsMasked + x]) return;
  ram[Enemy_CollisionBits + x] |= 0x01;
  if (id === Spiny || id === BulletBill_CannonVar) {
    ChkForPlayerInjury(x);
    return;
  }
  if (id === PiranhaPlant || id === Podoboo || id >= 0x15 || ram[AreaType] === 0) {
    InjurePlayer();
    return;
  }
  if ((ram[Enemy_State + x] & 0x80) || (ram[Enemy_State + x] & 0x07) < 0x02) {
    ChkForPlayerInjury(x);
    return;
  }
  if (ram[Enemy_ID + x] === Goomba) return;
  ram[Square1SoundQueue] = Sfx_EnemySmack;
  ram[Enemy_State + x] |= 0x80;
  const y = EnemyFacePlayer(x);
  ram[Enemy_X_Speed + x] = ROM[L.KickedShellXSpdData + y];
  let a = add(0x03, ram[StompChainCounter]);
  const t = ram[EnemyIntervalTimer + x];
  if (t < 0x03) a = ROM[L.KickedShellPtsData + t];
  SetupFloateyNumber(x, a);
}

function ChkForPlayerInjury(x) {
  const vs = ram[Player_Y_Speed];
  if (!neg(vs) && vs !== 0) {
    EnemyStomped(x);
    return;
  }
  // ChkInj
  if (ram[Enemy_ID + x] >= Bloober) {
    if (add(ram[Player_Y_Position], 0x0c) < ram[Enemy_Y_Position + x]) {
      EnemyStomped(x);
      return;
    }
  }
  // ChkETmrs
  if (ram[StompTimer]) {
    EnemyStomped(x);
    return;
  }
  if (ram[InjuryTimer]) return;
  if (ram[Player_Rel_XPos] < ram[Enemy_Rel_XPos]) {
    if (ram[Enemy_MovingDir + x] !== 0x01) InjurePlayer();
    else {
      EnemyTurnAround(x);
      InjurePlayer();
    }
  } else {
    if (ram[Enemy_MovingDir + x] === 0x01) InjurePlayer();
    else {
      EnemyTurnAround(x);
      InjurePlayer();
    }
  }
}

function InjurePlayer() {
  if (ram[InjuryTimer]) return;
  ForceInjury(0);
}

function ForceInjury(a) {
  if (ram[PlayerStatus] === 0) {
    KillPlayer();
    return;
  }
  ram[PlayerStatus] = a;
  ram[InjuryTimer] = 0x08;
  ram[Square1SoundQueue] = Sfx_PipeDown_Injury;
  GetPlayerColors();
  SetPRout(0x0a, 0x01);
}

function KillPlayer() {
  ram[Player_X_Speed] = 0;
  ram[EventMusicQueue] = DeathMusic;
  ram[Player_Y_Speed] = 0xfc;
  SetPRout(0x0b, 0x01);
}

function SetPRout(a, y) {
  ram[GameEngineSubroutine] = a;
  ram[Player_State] = y;
  ram[TimerControl] = 0xff;
  ram[ScrollAmount] = 0;
}

function EnemyStomped(x) {
  const id = ram[Enemy_ID + x];
  if (id === Spiny) {
    InjurePlayer();
    return;
  }
  ram[Square1SoundQueue] = Sfx_EnemyStomp;
  let y = -1;
  if (id === FlyingCheepCheep || id === BulletBill_FrenzyVar || id === BulletBill_CannonVar || id === Podoboo) y = 0;
  else if (id === HammerBro) y = 1;
  else if (id === Lakitu) y = 2;
  else if (id === Bloober) y = 3;
  if (y >= 0) {
    // EnemyStompedPts
    SetupFloateyNumber(x, ROM[L.StompedEnemyPtsData + y]);
    const md = ram[Enemy_MovingDir + x];
    SetStun(x);
    ram[Enemy_MovingDir + x] = md;
    ram[Enemy_State + x] = 0x20;
    InitVStf(x);
    ram[Enemy_X_Speed + x] = 0;
    ram[Player_Y_Speed] = 0xfd;
    return;
  }
  if (id >= 0x09) {
    // ChkForDemoteKoopa
    ram[Enemy_ID + x] = id & 0x01;
    ram[Enemy_State + x] = 0;
    SetupFloateyNumber(x, 0x03);
    InitVStf(x);
    const d = EnemyFacePlayer(x);
    ram[Enemy_X_Speed + x] = ROM[L.DemotedKoopaXSpdData + d];
    ram[Player_Y_Speed] = 0xfc;
    return;
  }
  // HandleStompedShellE
  ram[Enemy_State + x] = 0x04;
  ram[StompChainCounter]++;
  SetupFloateyNumber(x, add(ram[StompChainCounter], ram[StompTimer]));
  ram[StompTimer]++;
  ram[EnemyIntervalTimer + x] = ROM[L.RevivalRateData + ram[PrimaryHardMode]];
  ram[Player_Y_Speed] = 0xfc;
}

// sets moving direction toward the side away from the player; returns direction-1
function EnemyFacePlayer(x) {
  let y = 0x01;
  if (neg(PlayerEnemyDiff(x))) y++;
  ram[Enemy_MovingDir + x] = y;
  return y - 1;
}

function SetupFloateyNumber(x, a) {
  ram[FloateyNum_Control + x] = a;
  ram[FloateyNum_Timer + x] = 0x30;
  ram[FloateyNum_Y_Pos + x] = ram[Enemy_Y_Position + x];
  ram[FloateyNum_X_Pos + x] = ram[Enemy_Rel_XPos];
  return ram[Enemy_Rel_XPos];
}

// -------------------------------------------------------------------------------------

function EnemiesCollision(x) {
  if (!(ram[FrameCounter] & 1)) return;
  if (ram[AreaType] === 0) return;
  const id = ram[Enemy_ID + x];
  if (id >= 0x15 || id === Lakitu || id === PiranhaPlant) return;
  if (ram[EnemyOffscrBitsMasked + x]) return;
  const y0 = GetEnemyBoundBoxOfs();
  for (let e = x - 1; e >= 0; e--) {
    ram[0x01] = e;
    if (!ram[Enemy_Flag + e]) continue;
    const id2 = ram[Enemy_ID + e];
    if (id2 >= 0x15 || id2 === Lakitu || id2 === PiranhaPlant) continue;
    if (ram[EnemyOffscrBitsMasked + e]) continue;
    const hit = SprObjectCollisionCore(((e << 2) + 0x04) & 0xff, y0);
    x = ram[ObjectOffset];
    const y = ram[0x01];
    if (!hit) {
      ram[Enemy_CollisionBits + y] &= ROM[L.ClearBitsMask + x];
      continue;
    }
    if (!((ram[Enemy_State + x] | ram[Enemy_State + y]) & 0x80)) {
      if (ram[Enemy_CollisionBits + y] & ROM[L.SetBitsMask + x]) continue;
      ram[Enemy_CollisionBits + y] |= ROM[L.SetBitsMask + x];
    }
    ProcEnemyCollisions(x, y);
  }
}

function ProcEnemyCollisions(x, y) {
  if ((ram[Enemy_State + y] | ram[Enemy_State + x]) & 0x20) return;
  if (ram[Enemy_State + x] >= 0x06) {
    if (ram[Enemy_ID + x] === HammerBro) return;
    if (ram[Enemy_State + y] & 0x80) {
      SetupFloateyNumber(x, 0x06);
      ShellOrBlockDefeat(x);
      y = ram[0x01];
    }
    // ShellCollisions
    ShellOrBlockDefeat(y);
    x = ram[ObjectOffset];
    const a = add(ram[ShellChainCounter + x], 0x04);
    SetupFloateyNumber(ram[0x01], a);
    ram[ShellChainCounter + ram[ObjectOffset]]++;
    return;
  }
  // ProcSecondEnemyColl
  if (ram[Enemy_State + y] >= 0x06) {
    if (ram[Enemy_ID + y] === HammerBro) return;
    ShellOrBlockDefeat(x);
    y = ram[0x01];
    const a = add(ram[ShellChainCounter + y], 0x04);
    SetupFloateyNumber(ram[ObjectOffset], a);
    ram[ShellChainCounter + ram[0x01]]++;
    return;
  }
  // MoveEOfs
  EnemyTurnAround(y);
  EnemyTurnAround(ram[ObjectOffset]);
}

function EnemyTurnAround(x) {
  const id = ram[Enemy_ID + x];
  if (id === PiranhaPlant || id === Lakitu || id === HammerBro) return;
  if (id !== Spiny && id !== GreenParatroopaJump && id >= 0x07) return;
  RXSpd(x);
}

function RXSpd(x) {
  ram[Enemy_X_Speed + x] = twos(ram[Enemy_X_Speed + x]);
  ram[Enemy_MovingDir + x] ^= 0x03;
}

// -------------------------------------------------------------------------------------

function LargePlatformCollision(x) {
  ram[PlatformCollisionFlag + x] = 0xff;
  if (ram[TimerControl]) return;
  if (neg(ram[Enemy_State + x])) return;
  if (ram[Enemy_ID + x] === 0x24) ChkForPlayerC_LargeP(ram[Enemy_State + x]);
  ChkForPlayerC_LargeP(ram[ObjectOffset]);
}

function ChkForPlayerC_LargeP(x) {
  if (CheckPlayerVertical()) return;
  const y = GetEnemyBoundBoxOfsArg(x);
  ram[0x00] = ram[Enemy_Y_Position + x];
  if (!PlayerCollisionCore(y)) return;
  ProcLPlatCollisions(x, y);
}

function SmallPlatformCollision(x) {
  if (ram[TimerControl]) return;
  ram[PlatformCollisionFlag + x] = 0;
  if (CheckPlayerVertical()) return;
  ram[0x00] = 0x02;
  do {
    x = ram[ObjectOffset];
    const y = GetEnemyBoundBoxOfs();
    if (ram[Enemy_OffscreenBits] & 0x02) return;
    if (ram[BoundingBox_UL_YPos + y] >= 0x20) {
      if (PlayerCollisionCore(y)) {
        ProcLPlatCollisions(ram[ObjectOffset], y);
        return;
      }
    }
    ram[BoundingBox_UL_YPos + y] = add(ram[BoundingBox_UL_YPos + y], 0x80);
    ram[BoundingBox_DR_YPos + y] = add(ram[BoundingBox_DR_YPos + y], 0x80);
    ram[0x00]--;
  } while (ram[0x00] !== 0);
}

function ProcLPlatCollisions(x, y) {
  if (sub(ram[BoundingBox_DR_YPos + y], ram[BoundingBox_UL_YPos]) < 0x04 && neg(ram[Player_Y_Speed])) {
    ram[Player_Y_Speed] = 0x01;
  }
  // ChkForTopCollision
  if (sub(ram[BoundingBox_DR_YPos], ram[BoundingBox_UL_YPos + y]) < 0x06 && !neg(ram[Player_Y_Speed])) {
    let a = ram[0x00];
    const id = ram[Enemy_ID + x];
    if (id !== 0x2b && id !== 0x2c) a = x;
    ram[PlatformCollisionFlag + ram[ObjectOffset]] = a;
    ram[Player_State] = 0;
    return;
  }
  // PlatformSideCollisions
  ram[0x00] = 0x01;
  let side = sub(ram[BoundingBox_DR_XPos], ram[BoundingBox_UL_XPos + y]) < 0x08;
  if (!side) {
    ram[0x00]++;
    C = 0;
    if (sbc(ram[BoundingBox_DR_XPos + y], ram[BoundingBox_UL_XPos]) < 0x09) side = true;
  }
  if (side) ImpedePlayerMove();
}

function PositionPlayerOnS_Plat(x, a) {
  PositionPlayerOnVPlatA(x, add(ram[Enemy_Y_Position + x], ROM[L.PlayerPosSPlatData - 1 + a]));
}

function PositionPlayerOnVPlat(x) {
  PositionPlayerOnVPlatA(x, ram[Enemy_Y_Position + x]);
}

function PositionPlayerOnVPlatA(x, a) {
  if (ram[GameEngineSubroutine] === 0x0b) return;
  const y = ram[Enemy_Y_HighPos + x];
  if (y !== 0x01) return;
  ram[Player_Y_Position] = sub(a, 0x20);
  ram[Player_Y_HighPos] = sbc(y, 0x00);
  ram[Player_Y_Speed] = 0;
  ram[Player_Y_MoveForce] = 0;
}

// returns true (carry set) if the player is offscreen vertically or too far down
function CheckPlayerVertical() {
  if (ram[Player_OffscreenBits] >= 0xf0) return true;
  if (ram[Player_Y_HighPos] !== 0x01) return false;
  return ram[Player_Y_Position] >= 0xd0;
}

function GetEnemyBoundBoxOfs() {
  return GetEnemyBoundBoxOfsArg(ram[ObjectOffset]);
}

function GetEnemyBoundBoxOfsArg(a) {
  return ((a << 2) + 0x04) & 0xff;
}

// -------------------------------------------------------------------------------------

function PlayerBGCollision() {
  if (ram[DisableCollisionDet]) return;
  const g = ram[GameEngineSubroutine];
  if (g === 0x0b || g < 0x04) return;
  if (ram[SwimmingFlag]) {
    ram[Player_State] = 0x01;
  } else {
    const s = ram[Player_State];
    if (s === 0 || s === 0x03) ram[Player_State] = 0x02;
  }
  if (ram[Player_Y_HighPos] !== 0x01) return;
  ram[Player_CollisionBits] = 0xff;
  if (ram[Player_Y_Position] >= 0xcf) return;
  // ChkCollSize
  let y = 0x02;
  if (!ram[CrouchingFlag] && !ram[PlayerSize]) {
    y--;
    if (!ram[SwimmingFlag]) y--;
  }
  ram[0xeb] = ROM[L.BlockBufferAdderData + y];
  y = ram[0xeb];
  let sz = ram[PlayerSize];
  if (ram[CrouchingFlag]) sz++;
  // HeadChk
  if (ram[Player_Y_Position] >= ROM[L.PlayerBGUpperExtent + sz]) {
    const mt = BlockBufferCollision(0, 0, y);
    if (mt !== 0) {
      if (CheckForCoinMTiles(mt)) {
        HandleCoinMetatile();
        return;
      }
      if (neg(ram[Player_Y_Speed]) && ram[0x04] >= 0x04) {
        if (CheckForSolidMTiles(mt)) {
          if (mt !== 0x26) ram[Square1SoundQueue] = Sfx_Bump;
          ram[Player_Y_Speed] = 0x01;
        } else if (ram[AreaType] === 0 || ram[BlockBounceTimer]) {
          ram[Player_Y_Speed] = 0x01;
        } else {
          PlayerHeadCollision(mt);
        }
      }
    }
  }
  // DoFootCheck
  y = ram[0xeb];
  let side = true;
  if (ram[Player_Y_Position] < 0xcf) {
    const left = BlockBufferCollision(0, 0, y + 1);
    if (CheckForCoinMTiles(left)) {
      HandleCoinMetatile();
      return;
    }
    const right = BlockBufferCollision(0, 0, y + 2);
    ram[0x00] = right;
    ram[0x01] = left;
    let mt = -1;
    if (left !== 0) mt = left;
    else if (right !== 0) {
      if (CheckForCoinMTiles(right)) {
        HandleCoinMetatile();
        return;
      }
      mt = right;
    }
    if (mt >= 0) {
      // ChkFootMTile
      if (!CheckForClimbMTiles(mt) && !neg(ram[Player_Y_Speed])) {
        if (mt === 0xc5) {
          HandleAxeMetatile();
          return;
        }
        if (!ChkInvisibleMTiles(mt)) {
          if (!ram[JumpspringAnimCtrl]) {
            if (ram[0x04] >= 0x05) {
              ram[0x00] = ram[Player_MovingDir];
              ImpedePlayerMove();
              return;
            }
            // LandPlyr
            ChkForLandJumpSpring(mt);
            ram[Player_Y_Position] &= 0xf0;
            HandlePipeEntry();
            ram[Player_Y_Speed] = 0;
            ram[Player_Y_MoveForce] = 0;
            ram[StompChainCounter] = 0;
          }
          ram[Player_State] = 0;
        }
      }
    }
  }
  if (!side) return;
  // DoPlayerSideCheck
  y = (ram[0xeb] + 2) & 0xff;
  ram[0x00] = 0x02;
  for (;;) {
    y++;
    ram[0xeb] = y;
    let mt = 0;
    let doBHalf = true;
    const py = ram[Player_Y_Position];
    if (py >= 0x20) {
      if (py >= 0xe4) return;
      mt = BlockBufferCollision(0, 1, y);
      if (mt !== 0 && mt !== 0x1c && mt !== 0x6b && !CheckForClimbMTiles(mt)) {
        CheckSideMTiles(mt);
        return;
      }
    }
    if (doBHalf) {
      y = ram[0xeb] + 1;
      const py2 = ram[Player_Y_Position];
      if (py2 < 0x08 || py2 >= 0xd0) return;
      mt = BlockBufferCollision(0, 1, y);
      if (mt !== 0) {
        CheckSideMTiles(mt);
        return;
      }
      ram[0x00]--;
      if (ram[0x00] === 0) return;
    }
  }
}

function CheckSideMTiles(mt) {
  if (ChkInvisibleMTiles(mt)) return;
  if (CheckForClimbMTiles(mt)) {
    HandleClimbing(mt);
    return;
  }
  if (CheckForCoinMTiles(mt)) {
    HandleCoinMetatile();
    return;
  }
  if (ChkJumpspringMetatiles(mt)) {
    if (ram[JumpspringAnimCtrl]) return;
    ImpedePlayerMove();
    return;
  }
  // ChkPBtm
  if (ram[Player_State] !== 0 || ram[PlayerFacingDir] !== 1 || (mt !== 0x6c && mt !== 0x1f)) {
    ImpedePlayerMove();
    return;
  }
  // PipeDwnS
  if (!ram[Player_SprAttrib]) ram[Square1SoundQueue] = Sfx_PipeDown_Injury;
  ram[Player_SprAttrib] |= 0x20;
  if (ram[Player_X_Position] & 0x0f) {
    ram[ChangeAreaTimer] = ROM[L.AreaChangeTimerData + (ram[ScreenLeft_PageLoc] ? 1 : 0)];
  }
  const g = ram[GameEngineSubroutine];
  if (g === 0x07 || g !== 0x08) return;
  ram[GameEngineSubroutine] = 0x02;
}

function HandleCoinMetatile() {
  ErACM();
  ram[CoinTallyFor1Ups]++;
  GiveOneCoin();
}

function HandleAxeMetatile() {
  ram[OperMode_Task] = 0;
  ram[OperMode] = 0x02;
  ram[Player_X_Speed] = 0x18;
  ErACM();
}

function ErACM() {
  ram[ptr(0x06) + ram[0x02]] = 0;
  RemoveCoin_Axe();
}

function HandleClimbing(mt) {
  const y = ram[0x04];
  if (y < 0x06 || y >= 0x0a) return;
  if (mt === 0x24 || mt === 0x25) {
    // FlagpoleCollision
    if (ram[GameEngineSubroutine] !== 0x05) {
      ram[PlayerFacingDir] = 0x01;
      ram[ScrollLock]++;
      if (ram[GameEngineSubroutine] !== 0x04) {
        KillEnemies(BulletBill_CannonVar);
        ram[EventMusicQueue] = Silence;
        ram[FlagpoleSoundQueue] = Silence >> 1;
        let x = 0x04;
        const py = ram[Player_Y_Position];
        ram[FlagpoleCollisionYPos] = py;
        while (py < ROM[L.FlagpoleYPosData + x]) {
          x--;
          if (x === 0) break;
        }
        ram[FlagpoleScore] = x;
      }
      ram[GameEngineSubroutine] = 0x04;
    }
  } else if (mt === 0x26) {
    if (ram[Player_Y_Position] < 0x20) ram[GameEngineSubroutine] = 0x01;
  }
  // PutPlayerOnVine
  ram[Player_State] = 0x03;
  ram[Player_X_Speed] = 0;
  ram[Player_X_MoveForce] = 0;
  if (sub(ram[Player_X_Position], ram[ScreenLeft_X_Pos]) < 0x10) ram[PlayerFacingDir] = 0x02;
  const fd = ram[PlayerFacingDir];
  ram[Player_X_Position] = add((ram[0x06] << 4) & 0xff, ROM[L.ClimbXPosAdder - 1 + fd]);
  if (ram[0x06] === 0) {
    ram[Player_PageLoc] = add(ram[ScreenRight_PageLoc], ROM[L.ClimbPLocAdder - 1 + fd]);
  }
}

function ChkInvisibleMTiles(a) {
  return a === 0x5f || a === 0x60;
}

function ChkForLandJumpSpring(a) {
  if (!ChkJumpspringMetatiles(a)) return;
  ram[VerticalForce] = 0x70;
  ram[JumpspringForce] = 0xf9;
  ram[JumpspringTimer] = 0x03;
  ram[JumpspringAnimCtrl] = 0x01;
}

function ChkJumpspringMetatiles(a) {
  const r = a === 0x67 || a === 0x68;
  C = r ? 1 : 0;
  return r;
}

function HandlePipeEntry() {
  if (!(ram[Up_Down_Buttons] & 0x04)) return;
  if (ram[0x00] !== 0x11 || ram[0x01] !== 0x10) return;
  ram[ChangeAreaTimer] = 0x30;
  ram[GameEngineSubroutine] = 0x03;
  ram[Square1SoundQueue] = Sfx_PipeDown_Injury;
  ram[Player_SprAttrib] = 0x20;
  if (!ram[WarpZoneControl]) return;
  let x = (ram[WarpZoneControl] & 0x03) << 2;
  const px = ram[Player_X_Position];
  if (px >= 0x60) {
    x++;
    if (px >= 0xa0) x++;
  }
  const w = (ROM[L.WarpZoneNumbers + x] - 1) & 0xff;
  ram[WorldNumber] = w;
  ram[AreaPointer] = ROM[L.AreaAddrOffsets + ROM[L.WorldAddrOffsets + w]];
  ram[EventMusicQueue] = Silence;
  ram[EntrancePage] = 0;
  ram[AreaNumber] = 0;
  ram[LevelNumber] = 0;
  ram[AltEntranceControl] = 0;
  ram[Hidden1UpFlag]++;
  ram[FetchNewGameTimerFlag]++;
}

function ImpedePlayerMove() {
  let a = 0;
  const spd = ram[Player_X_Speed];
  let x;
  let move = false;
  if (ram[0x00] === 0x01) {
    x = 0x01;
    if (!neg(spd)) {
      a = 0xff;
      move = true;
    }
  } else {
    x = 0x02;
    if (!(!neg(spd) && spd >= 0x01)) {
      // CPY #$01; BPL ExIPM -> skip when (speed - 1) is positive
      if (neg((spd - 1) & 0xff)) {
        a = 0x01;
        move = true;
      }
    }
  }
  if (move) {
    ram[SideCollisionTimer] = 0x10;
    ram[Player_X_Speed] = 0;
    ram[0x00] = neg(a) ? 0xff : 0x00;
    ram[Player_X_Position] = add(a, ram[Player_X_Position]);
    ram[Player_PageLoc] = adc(ram[Player_PageLoc], ram[0x00]);
  }
  ram[Player_CollisionBits] &= (x ^ 0xff);
}

// these return true when carry would be set (metatile at or above the threshold)
function CheckForSolidMTiles(a) {
  return a >= ROM[L.SolidMTileUpperExt + (a >> 6)];
}
function CheckForClimbMTiles(a) {
  return a >= ROM[L.ClimbMTileUpperExt + (a >> 6)];
}
function CheckForCoinMTiles(a) {
  if (a === 0xc2 || a === 0xc3) {
    ram[Square2SoundQueue] = Sfx_CoinGrab;
    return true;
  }
  return false;
}

// -------------------------------------------------------------------------------------

function EnemyToBGCollisionDet(x) {
  if (ram[Enemy_State + x] & 0x20) return;
  if (!SubtEnemyYPos(x)) return;
  const id = ram[Enemy_ID + x];
  if (id === Spiny && ram[Enemy_Y_Position + x] < 0x25) return;
  if (id === GreenParatroopaJump) {
    EnemyJump(x);
    return;
  }
  if (id === HammerBro) {
    HammerBroBGColl(x);
    return;
  }
  if (id !== Spiny && id !== PowerUpObject && id >= 0x07) return;
  const mt = ChkUnderEnemy(x);
  if (mt !== 0) {
    HandleEToBGCollision(x, mt);
    return;
  }
  ChkForRedKoopa(x);
}

function HandleEToBGCollision(x, mt) {
  if (ChkForNonSolids(mt)) {
    ChkForRedKoopa(x);
    return;
  }
  if (mt !== 0x23) {
    LandEnemyProperly(x);
    return;
  }
  ram[ptr(0x06) + ram[0x02]] = 0;
  const id = ram[Enemy_ID + x];
  if (id >= 0x15) {
    ChkToStunEnemies(x, id);
    return;
  }
  if (id === Goomba) KillEnemyAboveBlock(x);
  // GiveOEPoints: A holds the enemy's relative X after SetupFloateyNumber
  ChkToStunEnemies(x, SetupFloateyNumber(x, 0x01));
}

function ChkToStunEnemies(x, a) {
  if (!(a < 0x09 || a >= 0x11 || (a >= 0x0a && a < PiranhaPlant))) {
    ram[Enemy_ID + x] = a & 0x01; // Demote
  }
  SetStun(x);
}

function SetStun(x) {
  ram[Enemy_State + x] = (ram[Enemy_State + x] & 0xf0) | 0x02;
  ram[Enemy_Y_Position + x] = (ram[Enemy_Y_Position + x] - 2) & 0xff;
  let a = 0xfd;
  if (ram[Enemy_ID + x] === Bloober || ram[AreaType] === 0) a = 0xff;
  ram[Enemy_Y_Speed + x] = a;
  let y = 0x01;
  if (neg(PlayerEnemyDiff(x))) y++;
  const id = ram[Enemy_ID + x];
  if (id !== BulletBill_CannonVar && id !== BulletBill_FrenzyVar) ram[Enemy_MovingDir + x] = y;
  ram[Enemy_X_Speed + x] = ROM[L.EnemyBGCXSpdData + y - 1];
}

function LandEnemyProperly(x) {
  if (sub(ram[0x04], 0x08) >= 0x05) {
    ChkForRedKoopa(x);
    return;
  }
  const st = ram[Enemy_State + x];
  if (st & 0x40) {
    LandEnemyInitState(x);
    return;
  }
  if (st & 0x80) {
    DoEnemySideCheck(x);
    return;
  }
  // ChkLandedEnemyState
  if (st === 0) {
    DoEnemySideCheck(x);
    return;
  }
  if (st !== 0x05) {
    if (st >= 0x03) return;
    if (st === 0x02) {
      ram[EnemyIntervalTimer + x] = ram[Enemy_ID + x] === Spiny ? 0x00 : 0x10;
      ram[Enemy_State + x] = 0x03;
      EnemyLanding(x);
      return;
    }
  }
  // ProcEnemyDirection
  const id = ram[Enemy_ID + x];
  if (id === Goomba) {
    LandEnemyInitState(x);
    return;
  }
  if (id === Spiny) {
    ram[Enemy_MovingDir + x] = 0x01;
    ram[Enemy_X_Speed + x] = 0x08;
    if (!(ram[FrameCounter] & 0x07)) {
      LandEnemyInitState(x);
      return;
    }
  }
  // InvtD
  let y = 0x01;
  if (neg(PlayerEnemyDiff(x))) y++;
  if (y === ram[Enemy_MovingDir + x]) ChkForBump_HammerBroJ(x);
  LandEnemyInitState(x);
}

function LandEnemyInitState(x) {
  EnemyLanding(x);
  if (ram[Enemy_State + x] & 0x80) ram[Enemy_State + x] &= 0xbf;
  else ram[Enemy_State + x] = 0;
}

function ChkForRedKoopa(x) {
  if (ram[Enemy_ID + x] === RedKoopa && ram[Enemy_State + x] === 0) {
    ChkForBump_HammerBroJ(x);
    return;
  }
  const st = ram[Enemy_State + x];
  ram[Enemy_State + x] = (st & 0x80) ? (st | 0x40) : ROM[L.EnemyBGCStateData + st];
  DoEnemySideCheck(x);
}

function DoEnemySideCheck(x) {
  if (ram[Enemy_Y_Position + x] < 0x20) return;
  ram[0xeb] = 0x02;
  for (let y = 0x16; y < 0x18; y++) {
    if (ram[0xeb] === ram[Enemy_MovingDir + x]) {
      const mt = BlockBufferChk_Enemy(x, 1, y);
      if (mt !== 0 && !ChkForNonSolids(mt)) {
        ChkForBump_HammerBroJ(x);
        return;
      }
    }
    ram[0xeb]--;
  }
}

function ChkForBump_HammerBroJ(x) {
  if (x !== 0x05 && (ram[Enemy_State + x] & 0x80)) ram[Square1SoundQueue] = Sfx_Bump;
  if (ram[Enemy_ID + x] === HammerBro) {
    ram[0x00] = 0;
    SetHJ(x, 0xfa);
    return;
  }
  RXSpd(x);
}

function EnemyLanding(x) {
  InitVStf(x);
  ram[Enemy_Y_Position + x] = (ram[Enemy_Y_Position + x] & 0xf0) | 0x08;
}

// returns carry: true if enemy Y + 62 >= 68
function SubtEnemyYPos(x) {
  return add(ram[Enemy_Y_Position + x], 0x3e) >= 0x44;
}

function EnemyJump(x) {
  if (SubtEnemyYPos(x) && add(ram[Enemy_Y_Speed + x], 0x02) >= 0x03) {
    const mt = ChkUnderEnemy(x);
    if (mt !== 0 && !ChkForNonSolids(mt)) {
      EnemyLanding(x);
      ram[Enemy_Y_Speed + x] = 0xfd;
    }
  }
  DoEnemySideCheck(x);
}

function HammerBroBGColl(x) {
  const mt = ChkUnderEnemy(x);
  if (mt !== 0) {
    if (mt === 0x23) {
      KillEnemyAboveBlock(x);
      return;
    }
    if (!ram[EnemyFrameTimer + x]) {
      ram[Enemy_State + x] &= 0x88;
      EnemyLanding(x);
      DoEnemySideCheck(x);
      return;
    }
  }
  ram[Enemy_State + x] |= 0x01;
}

function KillEnemyAboveBlock(x) {
  ShellOrBlockDefeat(x);
  ram[Enemy_Y_Speed + x] = 0xfc;
}

function ChkUnderEnemy(x) {
  return BlockBufferChk_Enemy(x, 0, 0x15);
}

function ChkForNonSolids(a) {
  return a === 0x26 || a === 0xc2 || a === 0xc3 || a === 0x5f || a === 0x60;
}

function FireballBGCollision(x) {
  if (ram[Fireball_Y_Position + x] >= 0x18) {
    const mt = BlockBufferChk_FBall(x);
    if (mt !== 0 && !ChkForNonSolids(mt)) {
      if (neg(ram[Fireball_Y_Speed + x]) || ram[FireballBouncingFlag + x]) {
        ram[Fireball_State + x] = 0x80;
        ram[Square1SoundQueue] = Sfx_Bump;
        return;
      }
      ram[Fireball_Y_Speed + x] = 0xfd;
      ram[FireballBouncingFlag + x] = 0x01;
      ram[Fireball_Y_Position + x] &= 0xf8;
      return;
    }
  }
  ram[FireballBouncingFlag + x] = 0;
}

// -------------------------------------------------------------------------------------

function GetFireballBoundBox(x) {
  const so = x + 7;
  const y = BoundingBoxCore(so, 0x02);
  CheckRightScreenBBox(so, y);
}

function GetMiscBoundBox(x) {
  const so = x + 9;
  const y = BoundingBoxCore(so, 0x06);
  CheckRightScreenBBox(so, y);
}

function GetEnemyBoundBox(x) {
  GetMaskedOffScrBits(x, 0x48, 0x44);
}

function SmallPlatformBoundBox(x) {
  GetMaskedOffScrBits(x, 0x08, 0x04);
}

function GetMaskedOffScrBits(x, m0, y) {
  ram[0x00] = m0;
  ram[0x01] = sub(ram[Enemy_X_Position + x], ram[ScreenLeft_X_Pos]);
  const p = sbc(ram[Enemy_PageLoc + x], ram[ScreenLeft_PageLoc]);
  let m = y;
  if (!neg(p) && (p | ram[0x01]) !== 0) m = ram[0x00];
  const v = m & ram[Enemy_OffscreenBits];
  ram[EnemyOffscrBitsMasked + x] = v;
  if (v) MoveBoundBoxOffscreen(x);
  else SetupEOffsetFBBox(x);
}

function LargePlatformBoundBox(x) {
  const bits = GetXOffscreenBits(x + 1);
  if (bits >= 0xfe) MoveBoundBoxOffscreen(x);
  else SetupEOffsetFBBox(x);
}

function SetupEOffsetFBBox(x) {
  const so = x + 1;
  const y = BoundingBoxCore(so, 0x01);
  CheckRightScreenBBox(so, y);
}

function MoveBoundBoxOffscreen(x) {
  const y = (x << 2) & 0xff;
  ram[EnemyBoundingBoxCoord + y] = 0xff;
  ram[EnemyBoundingBoxCoord + 1 + y] = 0xff;
  ram[EnemyBoundingBoxCoord + 2 + y] = 0xff;
  ram[EnemyBoundingBoxCoord + 3 + y] = 0xff;
}

// x = sprite object index, y = relative position index; returns bbox offset
function BoundingBoxCore(x, y) {
  ram[0x00] = x;
  ram[0x02] = ram[SprObject_Rel_YPos + y];
  ram[0x01] = ram[SprObject_Rel_XPos + y];
  const o = (x << 2) & 0xff;
  const c = (ram[SprObj_BoundBoxCtrl + x] << 2) & 0xff;
  ram[BoundingBox_UL_Corner + o] = add(ram[0x01], ROM[L.BoundBoxCtrlData + c]);
  ram[BoundingBox_LR_Corner + o] = add(ram[0x01], ROM[L.BoundBoxCtrlData + c + 2]);
  ram[BoundingBox_UL_Corner + o + 1] = add(ram[0x02], ROM[L.BoundBoxCtrlData + c + 1]);
  ram[BoundingBox_LR_Corner + o + 1] = add(ram[0x02], ROM[L.BoundBoxCtrlData + c + 3]);
  return o;
}

function CheckRightScreenBBox(x, y) {
  ram[0x02] = add(ram[ScreenLeft_X_Pos], 0x80);
  ram[0x01] = adc(ram[ScreenLeft_PageLoc], 0x00);
  cmp(ram[SprObject_X_Position + x], ram[0x02]);
  sbc(ram[SprObject_PageLoc + x], ram[0x01]);
  if (C) {
    if (neg(ram[BoundingBox_DR_XPos + y])) return;
    if (!neg(ram[BoundingBox_UL_XPos + y])) ram[BoundingBox_UL_XPos + y] = 0xff;
    ram[BoundingBox_DR_XPos + y] = 0xff;
    return;
  }
  // CheckLeftScreenBBox
  const ul = ram[BoundingBox_UL_XPos + y];
  if (!neg(ul) || ul < 0xa0) return;
  if (!neg(ram[BoundingBox_DR_XPos + y])) ram[BoundingBox_DR_XPos + y] = 0;
  ram[BoundingBox_UL_XPos + y] = 0;
}

function PlayerCollisionCore(y) {
  return SprObjectCollisionCore(0, y);
}

// x and y are bounding box offsets; returns true on collision (carry set)
function SprObjectCollisionCore(x, y) {
  ram[0x06] = y;
  ram[0x07] = 0x01;
  for (;;) {
    const a = ram[BoundingBox_UL_Corner + y];
    const ul2 = ram[BoundingBox_UL_Corner + x];
    const lr2 = ram[BoundingBox_LR_Corner + x];
    const ul1 = a;
    const lr1 = ram[BoundingBox_LR_Corner + y];
    let found;
    if (a >= ul2) {
      // FirstBoxGreater
      if (a === ul2 || a <= lr2) found = true;
      else if (a <= lr1) found = false;
      else found = lr1 >= ul2;
    } else if (a < lr2) {
      // SecondBoxVerticalChk
      found = lr2 < ul2 || lr1 >= ul2;
    } else if (a === lr2) {
      found = true;
    } else {
      found = lr1 < ul1 || lr1 >= ul2;
    }
    if (!found) {
      C = 0;
      return false;
    }
    x++;
    y++;
    ram[0x07] = (ram[0x07] - 1) & 0xff;
    if (neg(ram[0x07])) {
      C = 1;
      return true;
    }
  }
}

function BlockBufferChk_Enemy(x, a, y) {
  return BlockBufferCollision(x + 1, a, y);
}

function BlockBufferChk_FBall(x) {
  return BlockBufferCollision(x + 7, 0, 0x1a);
}

// x = sprite object index; a = 0 to return vertical low nybble in $04, 1 for
// horizontal; y = adder offset. Returns the metatile at that point.
function BlockBufferCollision(x, a, y) {
  ram[0x04] = y;
  ram[0x05] = add(ROM[L.BlockBuffer_X_Adder + y], ram[SprObject_X_Position + x]);
  const page = adc(ram[SprObject_PageLoc + x], 0x00) & 0x01;
  const v = (page << 4) | (ram[0x05] >> 4);
  GetBlockBufferAddr(v);
  const yy = sub((ram[SprObject_Y_Position + x] + ROM[L.BlockBuffer_Y_Adder + y]) & 0xf0, 0x20);
  ram[0x02] = yy;
  ram[0x03] = ram[(ptr(0x06) + yy) & 0x7ff];
  const src = a === 0 ? ram[SprObject_Y_Position + x] : ram[SprObject_X_Position + x];
  ram[0x04] = src & 0x0f;
  return ram[0x03];
}
