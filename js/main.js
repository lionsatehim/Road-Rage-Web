// Bootstrap: fixed-timestep simulation (60Hz), decoupled rendering.
// Scenes:
//   select     — pick a career track (1/2/3)
//   drive      — active shift, full game loop
//   shift_end  — post-shift summary + promotion/demotion ribbon
//   game_over  — demoted from the bottom rung
//   retired    — lifetime earnings target reached
(function () {
  const C = RR.Config;
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  function fitCanvas() {
    const sx = Math.floor(window.innerWidth  / C.INTERNAL_WIDTH);
    const sy = Math.floor(window.innerHeight / C.INTERNAL_HEIGHT);
    const scale = Math.max(1, Math.min(sx, sy));
    canvas.style.width  = (C.INTERNAL_WIDTH  * scale) + 'px';
    canvas.style.height = (C.INTERNAL_HEIGHT * scale) + 'px';
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  const career = RR.Career.load();

  const state = {
    // Always boot to select; the screen offers Continue if a save exists,
    // or 1/2/3 to start fresh (which wipes the save via pickTrack).
    scene: 'select',
    paused: false,
    car: RR.Car.create(),
    worldOffset: 0,
    traffic: RR.Traffic.create(),
    rage: RR.Rage.create(),
    powerups: RR.Powerups.create(),
    style: RR.Style.create(career.lifetimeStyle || 0),
    career,
    time: 0,
    shockTimer: 0,
    banner: { text: '', color: '#fff', timer: 0 },
    tireMarks: [],
    tireBurst: 0,
    prevSpeed: 0,
    prevOffRoad: false,
    // Style detection bookkeeping.
    nearMissCandidate: null,    // { npc, dy, t } when player brakes near an NPC ahead
    hazardSeen: new Map(),      // hazard ref → { minDx, latVelAtMin, lastY }
    npcWasAhead: new Map(),     // npc ref → boolean (last frame's "ahead of player")
    activeJumpClearances: new Set(), // npcs already credited this jump
    activeJumpHops: new Set(),       // hazard refs already credited this jump
    lastJumpHeight: 0,
    prevLaneIdx: -1,
  };


  const STEP = 1 / 60;
  const MAX_FRAME = 0.25;
  let acc = 0;
  let last = performance.now();

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    acc += dt;
    while (acc >= STEP) {
      tick(STEP);
      acc -= STEP;
    }
    draw();
    requestAnimationFrame(frame);
  }

  function tick(dt) {
    if (RR.Input.consumeEdge('KeyM')) RR.Audio.toggleMuted();
    state.time += dt;

    switch (state.scene) {
      case 'select':    tickSelect();          break;
      case 'drive':     tickDrive(dt);         break;
      case 'shift_end': tickShiftEnd();        break;
      case 'game_over':
      case 'retired':   tickEndState();        break;
    }
  }

  // ---------- Scene: SELECT ----------
  function tickSelect() {
    // C continues an existing save without resetting streaks/earnings.
    if (state.career.track && RR.Input.consumeEdge('KeyC')) {
      state.scene = 'drive';
      beginShift();
      return;
    }
    let pick = null;
    if (RR.Input.consumeEdge('Digit1')) pick = 'trades';
    if (RR.Input.consumeEdge('Digit2')) pick = 'finance';
    if (RR.Input.consumeEdge('Digit3')) pick = 'teacher';
    if (pick) {
      RR.Career.pickTrack(state.career, pick);
      state.scene = 'drive';
      beginShift();
    }
  }

  // ---------- Scene: DRIVE ----------
  function beginShift() {
    RR.Career.startShift(state.career);
    state.car = RR.Car.create();
    state.worldOffset = 0;
    state.traffic = RR.Traffic.create();
    state.rage = RR.Rage.create();
    state.powerups = RR.Powerups.create();
    RR.Style.resetShift(state.style);
    state.style.lifetime = state.career.lifetimeStyle || 0;
    state.tireMarks = [];
    state.tireBurst = 0;
    state.prevSpeed = 0;
    state.prevOffRoad = false;
    state.shockTimer = 0;
    state.banner.timer = 0;
    state.paused = false;
    state.nearMissCandidate = null;
    state.hazardSeen.clear();
    state.npcWasAhead.clear();
    state.activeJumpClearances.clear();
    state.activeJumpHops.clear();
    state.lastJumpHeight = 0;
    state.prevLaneIdx = -1;
    const mapType = RR.Career.currentMapType(state.career);
    state.road = RR.Road.create(mapType, RR.Config.CAREERS.shiftDistance);
    state.map = RR.Map.create(mapType);
    state.hazards = RR.Hazards.create(mapType);
    // Start the player in the slow (rightmost) lane every shift.
    const centers = RR.Road.laneCenters(state.road);
    state.car.x = centers[centers.length - 1];
  }

  function tickDrive(dt) {
    if (RR.Input.consumePause()) state.paused = !state.paused;
    if (state.paused) {
      if (RR.Input.consumeEdge('KeyR')) {
        RR.Career.clearSave();
        state.career = RR.Career.load();
        state.scene = 'select';
        state.paused = false;
        RR.Audio.stopLofi();
      }
      return;
    }
    const input = RR.Input.read();

    // Update road geometry first so car/traffic/powerups all see current bounds.
    if (state.road) RR.Road.update(state.road, state.worldOffset);

    const inRR = RR.Rage.isRoadRage(state.rage);
    const puMods = RR.Powerups.carMods(state.powerups);
    const mods = mergeMods(
      inRR ? {
        speedBoost: RR.Config.RAGE.roadRageSpeedBoost,
        steerBoost: RR.Config.RAGE.roadRageSteerBoost,
      } : null,
      puMods,
    );

    const npcScale = RR.Powerups.npcTimeScale(state.powerups);

    RR.Car.update(state.car, dt, input, mods, state.road);
    RR.Traffic.update(state.traffic, dt, state.car, npcScale, state.road);
    if (state.map) RR.Map.update(state.map, dt, state.car, state.road);
    if (state.hazards) RR.Hazards.update(state.hazards, dt, state.car, state.road);

    const passThrough = RR.Powerups.isJumping(state.powerups) ||
                        RR.Powerups.isInvincible(state.powerups);
    const hit = passThrough ? null
      : RR.Traffic.checkCollisions(state.traffic, state.car, inRR);
    const hazardHit = (passThrough || !state.hazards) ? null
      : RR.Hazards.checkCollisions(state.hazards, state.car);

    // Coffee scales every rage gain (contact, brake, cut-ins, getting passed)
    // by 1.5x; drains are unaffected.
    const coffeeMult = RR.Powerups.isCoffee(state.powerups)
      ? RR.Config.RAGE.coffeeGainMult : 1;

    const dmgMult = inRR ? RR.Config.RAGE.roadRageDamageMult : 1;

    if (hit) {
      RR.Career.addDamage(state.career, hit.kind, dmgMult);
      RR.Rage.onHit(state.rage, hit.kind, coffeeMult);
      if (hit.kind === 'ram') RR.Style.onRageHit(state.style, state.car);
      else                    RR.Style.onCrash(state.style);
    }
    if (hazardHit) {
      const hcfg = hazardHit.cfg;
      RR.Career.addDamageAmount(state.career, hcfg.damage, dmgMult);
      RR.Rage.flatBump(state.rage, hcfg.rageBump, coffeeMult);
      state.car.speed *= hcfg.speedKick;
      if (hcfg.lateralKnock) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        state.car.lateralVel = dir * hcfg.lateralKnock;
      }
      if (hcfg.stun) {
        state.car.lateralVel = 0;
        state.car.stunnedTimer = RR.Config.TRAFFIC.crashStunTime;
      }
      state.shockTimer = Math.max(state.shockTimer, hcfg.shock);
      RR.Audio.sfx(hcfg.stun ? 'crash' : 'tap');
      triggerBanner(hcfg.banner);
      // Solid hits (cones, potholes, stopped cars) break the pass streak.
      // A slick (puddle/oil) is a wobble — let the streak survive.
      if (hcfg.damage > 0) RR.Style.onCrash(state.style);
    }
    RR.Rage.update(state.rage, dt, state.car, state.traffic, input, coffeeMult);
    RR.Powerups.update(state.powerups, dt, state.car, state.rage, state.road);

    // Style detections — read from the freshly-updated systems.
    tickStyleDetections(dt, input);
    RR.Style.update(state.style, dt);

    // Power-up rage effects.
    if (state.powerups.justActivated === 'coffee') {
      RR.Rage.reduceFlat(state.rage, RR.Config.RAGE.coffeeImmediateDrop);
    }
    if (state.powerups.justActivated === 'shortcut') {
      RR.Rage.reducePct(state.rage, RR.Config.RAGE.shortcutReducePct);
    }
    if (state.powerups.justExpired === 'jump') {
      RR.Rage.reducePct(state.rage, RR.Config.RAGE.jumpLandReducePct);
    }

    // Rage entry banner — extra-loud when the trigger was a crash so the
    // player knows they can floor it without stopping to recover.
    if (state.rage.justEnteredRR) {
      if (state.rage.justEnteredFromCrash) {
        triggerCustomBanner('RAGE! GO!', '#ff6060');
      } else {
        triggerCustomBanner('RAGE MODE', '#ff6060');
      }
    }

    updateTireMarks(dt);

    if (state.powerups.justActivated === 'shortcut') {
      const advance = RR.Config.POWERUPS.types.shortcut.advance;
      state.worldOffset += advance;
      state.traffic.npcs = state.traffic.npcs.filter(n => n.y > state.car.y);
      state.shockTimer = 1.0;
    }

    // Style: power-up activated → flat award + special airtime award for jumps.
    if (state.powerups.justActivated) {
      RR.Style.onPowerup(state.style, state.powerups.justActivated, state.car);
      if (state.powerups.justActivated === 'jump') {
        RR.Style.onJump(state.style, state.car);
        state.activeJumpClearances.clear();
        state.activeJumpHops.clear();
      }
    }
    // Pass / passed-by streaks driven off rage's per-frame counters.
    if (state.rage.justPassedCount > 0) {
      RR.Style.onPass(state.style, state.rage.justPassedCount, state.car);
    }
    if (state.rage.justExitedRR) RR.Style.onRageExit(state.style);
    if (state.shockTimer > 0) state.shockTimer = Math.max(0, state.shockTimer - dt);
    if (state.banner.timer > 0) state.banner.timer = Math.max(0, state.banner.timer - dt);

    const dDist = state.car.speed * dt;
    state.worldOffset += dDist;
    RR.Career.tickShift(state.career, dt, dDist);

    // Passive career stress: distance-based drip so a quiet shift still ends
    // somewhere on the rage meter. Tuned per track (finance > trades > teacher).
    if (state.car.stunnedTimer <= 0 && !RR.Rage.isRoadRage(state.rage)) {
      const tcfg = RR.Career.trackCfg(state.career);
      const total = tcfg && tcfg.passiveStressTotal;
      if (total) {
        const rate = total / RR.Config.CAREERS.shiftDistance;
        state.rage.level = Math.min(100, state.rage.level + rate * dDist);
      }
    }

    audioTick(hit, inRR);

    // ---- Shift completion ----
    if (state.career.shift && state.career.shift.finished) {
      const levelIdxBefore = state.career.levelIdx;
      const result = RR.Career.finishShift(
        state.career,
        state.rage.level,
        RR.Rage.isRoadRage(state.rage),
      );
      // Style: shift-complete bonus, plus persist running lifetime back to
      // the career save. lifetime is the source of truth on this side.
      const shiftBonus = RR.Style.onShiftComplete(
        state.style, levelIdxBefore, result.late, result.raging, state.car,
      );
      result.styleShift = state.style.total;
      result.styleBonus = shiftBonus;
      state.career.lifetimeStyle = state.style.lifetime;
      // Re-save so the new lifetimeStyle persists. Skip if the career was
      // just wiped (game over / retire), so we don't resurrect the save.
      if (!result.gameOver && !result.retired) RR.Career.save(state.career);
      if (result.retired)        state.scene = 'retired';
      else if (result.gameOver)  state.scene = 'game_over';
      else                       state.scene = 'shift_end';
      RR.Audio.setEngine(0, false);
      RR.Audio.stopLofi();
    }
  }

  // ---------- Scene: SHIFT_END ----------
  function tickShiftEnd() {
    if (RR.Input.consumeEdge('Enter') || RR.Input.consumeEdge('Space')) {
      state.scene = 'drive';
      beginShift();
    }
  }

  // ---------- Scene: GAME_OVER / RETIRED ----------
  function tickEndState() {
    if (RR.Input.consumeEdge('KeyR') || RR.Input.consumeEdge('Enter')) {
      RR.Career.clearSave();
      state.career = RR.Career.load();
      state.scene = 'select';
    }
  }

  // ---------- Audio dispatch (drive scene only) ----------
  function audioTick(hit, inRR) {
    RR.Audio.setEngine(state.car.speed / RR.Config.CAR.maxSpeed, inRR);
    if (hit) RR.Audio.sfx(hit.kind);
    if (state.rage.justEnteredRR) RR.Audio.sfx('rageEnter');
    if (state.rage.justExitedRR)  RR.Audio.sfx('rageExit');
    if (state.rage.justHorn)      RR.Audio.sfx('horn');
    if (state.rage.justHornMash)  RR.Audio.sfx('hornMash');
    if (state.rage.justNearMiss)  RR.Audio.sfx('nearMiss');
    if (state.rage.justPassedCount > 0) RR.Audio.sfx('pass');
    if (state.powerups.justCollected)   RR.Audio.sfx('pickup');
    if (state.powerups.justActivated) {
      RR.Audio.sfx('powerup');
      if (state.powerups.justActivated === 'jump')     RR.Audio.sfx('yeehaw');
      if (state.powerups.justActivated === 'shortcut') RR.Audio.sfx('thunder');
      if (state.powerups.justActivated === 'lofi')     RR.Audio.startLofi();
      triggerBanner(state.powerups.justActivated);
    }
    if (state.powerups.justExpired === 'lofi') RR.Audio.stopLofi();
  }

  // ---------- Tire marks (drive scene helper) ----------
  function updateTireMarks(dt) {
    const car = state.car;
    const halfW = RR.Config.CAR.width / 2;
    const left = state.road ? state.road.leftEdge : RR.Config.ROAD.x;
    const right = state.road ? state.road.rightEdge : RR.Config.ROAD.x + RR.Config.ROAD.width;
    const normalLeft  = left + 2 + halfW;
    const normalRight = right - 2 - halfW;
    const offRoad = car.x < normalLeft - 0.5 || car.x > normalRight + 0.5;

    const rate = (car.speed - state.prevSpeed) / Math.max(dt, 1e-6);

    if (!offRoad) {
      if (state.prevOffRoad) state.tireBurst = Math.max(state.tireBurst, 0.25);
      if (rate < -240 && car.speed > 30) state.tireBurst = Math.max(state.tireBurst, 0.18);
      if (rate > 80 && car.speed < RR.Config.CAR.maxSpeed * 0.5) {
        state.tireBurst = Math.max(state.tireBurst, 0.18);
      }
    }
    state.tireBurst = Math.max(0, state.tireBurst - dt);

    const emit = (offRoad || state.tireBurst > 0) && car.speed > 20;
    if (emit) {
      const half = halfW - 2;
      const tailY = car.y + RR.Config.CAR.height / 2 - 2;
      state.tireMarks.push({ x: car.x - half, y: tailY, age: 0, life: 1.5 });
      state.tireMarks.push({ x: car.x + half, y: tailY, age: 0, life: 1.5 });
    }

    for (const m of state.tireMarks) {
      m.age += dt;
      m.y += car.speed * dt;
    }
    while (state.tireMarks.length > 240) state.tireMarks.shift();
    state.tireMarks = state.tireMarks.filter(m =>
      m.age < m.life && m.y < RR.Config.INTERNAL_HEIGHT + 8
    );

    state.prevSpeed = car.speed;
    state.prevOffRoad = offRoad;
  }

  // Style point detections that need per-frame state tracking. Pass-streak
  // and rage-streak events are handled inline in tickDrive (they piggy-back
  // on signals already produced elsewhere). This handles the trickier ones:
  //   - getting passed (resets pass streak)
  //   - near-miss (brake near a close NPC ahead)
  //   - narrow merge (lateral move with NPCs flanking in adjacent lanes)
  //   - fast dodge (hazard slips by while you swerved)
  //   - hazard hop / clearance (jump over things)
  //   - off-road shoulder time
  function tickStyleDetections(dt, input) {
    const car = state.car;
    if (car.stunnedTimer > 0) return;
    const styleCfg = RR.Config.STYLE;

    // ---- Player-passed-by-NPC: y-cross from behind to ahead ----
    const seenNpcs = new Set();
    for (const npc of state.traffic.npcs) {
      if (npc.crashed) continue;
      seenNpcs.add(npc);
      const isAhead = npc.y < car.y;
      const wasAhead = state.npcWasAhead.get(npc);
      if (wasAhead === false && isAhead) {
        // NPC crossed from behind to ahead → they passed us.
        if (Math.abs(npc.x - car.x) < RR.Config.RAGE.sidePassDx &&
            npc.speed > car.speed) {
          RR.Style.onPassedBy(state.style);
        }
      }
      state.npcWasAhead.set(npc, isAhead);
    }
    // Clean up tracker entries for NPCs that no longer exist.
    for (const k of state.npcWasAhead.keys()) {
      if (!seenNpcs.has(k)) state.npcWasAhead.delete(k);
    }

    // ---- Near-miss: brake held while an NPC is close ahead in same lane ----
    let closestAhead = null;
    let closestDy = Infinity;
    for (const npc of state.traffic.npcs) {
      if (npc.crashed) continue;
      if (Math.abs(npc.x - car.x) >= 12) continue;
      const dy = car.y - npc.y;
      if (dy > 0 && dy < closestDy) { closestDy = dy; closestAhead = npc; }
    }
    if (input.brake && closestAhead && closestDy < styleCfg.nearMissDy) {
      RR.Style.onNearMiss(state.style, car);
    }

    // ---- Narrow merge: changing lanes with NPCs flanking ----
    if (state.road) {
      const centers = RR.Road.laneCenters(state.road);
      let curLane = 0, bestD = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const d = Math.abs(centers[i] - car.x);
        if (d < bestD) { bestD = d; curLane = i; }
      }
      if (state.prevLaneIdx >= 0 && state.prevLaneIdx < centers.length &&
          curLane !== state.prevLaneIdx &&
          Math.abs(car.lateralVel) > styleCfg.narrowMergeMinLatVel) {
        // Check if both adjacent-lane NPCs are flanking us in the y window.
        const yWin = styleCfg.narrowMergeWindowDy;
        const prevCenter = centers[state.prevLaneIdx];
        const newCenter  = centers[curLane];
        let leftBlocked = false, rightBlocked = false;
        for (const npc of state.traffic.npcs) {
          if (npc.crashed) continue;
          if (Math.abs(npc.y - car.y) > yWin) continue;
          if (Math.abs(npc.x - prevCenter) < 12) leftBlocked = true;
          if (Math.abs(npc.x - newCenter)  < 12) rightBlocked = true;
        }
        if (leftBlocked && rightBlocked) {
          RR.Style.onNarrowMerge(state.style, car);
        }
      }
      state.prevLaneIdx = curLane;
    }

    // ---- Hazards: track each one's approach. Award on cross-and-pass. ----
    if (state.hazards) {
      const seenHaz = new Set();
      const jumping = state.lastJumpHeight > 0;
      for (const haz of state.hazards.hazards) {
        seenHaz.add(haz);
        const dx = Math.abs(haz.x - car.x);
        let bookkeeping = state.hazardSeen.get(haz);
        if (!bookkeeping) {
          bookkeeping = { minDx: dx, latVelAtMin: car.lateralVel, lastY: haz.y };
          state.hazardSeen.set(haz, bookkeeping);
        } else if (dx < bookkeeping.minDx) {
          bookkeeping.minDx = dx;
          bookkeeping.latVelAtMin = car.lateralVel;
        }
        // Hop credit: while jumping, the hazard's center crosses the player.
        if (jumping && bookkeeping.lastY < car.y && haz.y >= car.y &&
            dx < (RR.Config.HAZARDS.types[haz.type].width / 2 + RR.Config.CAR.width / 2) &&
            !state.activeJumpHops.has(haz)) {
          state.activeJumpHops.add(haz);
          RR.Style.onHazardHop(state.style, car);
        }
        // Fast dodge: hazard despawns having come close while we swerved,
        // and we're not jumping (jump is its own reward path).
        bookkeeping.lastY = haz.y;
      }
      // Detect fast-dodge as hazards leave the array. Require the hazard
      // to have last been seen well past the player — otherwise the
      // disappearance is from a collision (which removes it mid-screen).
      for (const haz of state.hazardSeen.keys()) {
        if (seenHaz.has(haz)) continue;
        const bk = state.hazardSeen.get(haz);
        state.hazardSeen.delete(haz);
        state.activeJumpHops.delete(haz);
        if (jumping) continue;
        const passedClean = bk.lastY > car.y + 6;
        if (passedClean &&
            bk.minDx <= styleCfg.fastDodgeDx &&
            Math.abs(bk.latVelAtMin) > styleCfg.fastDodgeMinLatVel) {
          RR.Style.onFastDodge(state.style, car);
        }
      }
    }

    // ---- Clearance: NPCs whose y crosses player.y while jumping. ----
    const jumpH = RR.Powerups.jumpHeight(state.powerups);
    if (jumpH > 0) {
      for (const npc of state.traffic.npcs) {
        if (npc.crashed) continue;
        const wasAhead = state.npcWasAhead.get(npc);
        const isAhead  = npc.y < car.y;
        if (wasAhead === true && !isAhead && Math.abs(npc.x - car.x) < 14 &&
            !state.activeJumpClearances.has(npc)) {
          state.activeJumpClearances.add(npc);
          RR.Style.onClearance(state.style, car);
        }
      }
    } else {
      // Reset clearance set the moment we land.
      if (state.lastJumpHeight > 0) {
        state.activeJumpClearances.clear();
        state.activeJumpHops.clear();
      }
    }
    state.lastJumpHeight = jumpH;

    // ---- Off-road shoulder time. Reuse prevOffRoad (set in updateTireMarks). ----
    if (state.prevOffRoad) RR.Style.onOffRoadTick(state.style, dt, car);
  }

  function triggerBanner(type) {
    const cfg = RR.Config.BANNERS[type];
    if (!cfg || !cfg.texts || cfg.texts.length === 0) return;
    const text = cfg.texts[Math.floor(Math.random() * cfg.texts.length)];
    state.banner.text = text;
    state.banner.color = cfg.color || '#fff';
    state.banner.timer = 1.23;
  }

  function triggerCustomBanner(text, color) {
    state.banner.text = text;
    state.banner.color = color || '#fff';
    state.banner.timer = 1.23;
  }

  function mergeMods(a, b) {
    if (!a) return b;
    if (!b) return a;
    const aCap = a.maxSpeedAbs, bCap = b.maxSpeedAbs;
    return {
      speedBoost: (a.speedBoost || 1) * (b.speedBoost || 1),
      steerBoost: (a.steerBoost || 1) * (b.steerBoost || 1),
      accelBoost: (a.accelBoost || 1) * (b.accelBoost || 1),
      shoulderExtra: a.shoulderExtra || b.shoulderExtra || 0,
      maxSpeedAbs: (aCap && bCap) ? Math.min(aCap, bCap) : (aCap || bCap),
    };
  }

  // ---------- Draw ----------
  function draw() {
    RR.Render.clear(ctx);
    if (state.scene === 'select') {
      RR.Render.drawCareerSelect(ctx, state.time, state.career);
      return;
    }
    // All other scenes show the road behind them.
    if (state.map) RR.Map.draw(ctx, state.map, state.worldOffset, state.road);
    if (state.road) RR.Road.draw(ctx, state.road, state.worldOffset);
    else RR.Render.drawRoad(ctx, state.worldOffset);
    RR.Render.drawShoulderStrips(ctx, state.powerups, state.road);
    RR.Render.drawTireMarks(ctx, state.tireMarks);
    if (state.hazards) RR.Hazards.draw(ctx, state.hazards);
    RR.Powerups.draw(ctx, state.powerups);
    RR.Traffic.draw(ctx, state.traffic);
    RR.Render.drawCar(ctx, state.car, RR.Rage.isRoadRage(state.rage),
                      RR.Powerups.jumpHeight(state.powerups),
                      RR.Powerups.invincibleRemaining(state.powerups));
    RR.Render.drawCoffeeVignette(ctx, state.powerups, state.time);
    RR.Render.drawRoadRageVignette(ctx, state.rage, state.time);
    RR.Render.drawShortcutFlash(ctx, state.shockTimer);
    RR.Style.drawFloaters(ctx, state.style);
    RR.Render.drawHUD(ctx, state, state.time);
    RR.Style.drawCounter(ctx, state.style);
    RR.Render.drawBanner(ctx, state.banner);

    if (state.scene === 'shift_end') {
      RR.Render.drawShiftEnd(ctx, state.career);
    } else if (state.scene === 'game_over') {
      RR.Render.drawGameOver(ctx, state.career);
    } else if (state.scene === 'retired') {
      RR.Render.drawRetired(ctx, state.career);
    } else if (state.paused) {
      RR.Render.drawPause(ctx);
    }
  }

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
})();
