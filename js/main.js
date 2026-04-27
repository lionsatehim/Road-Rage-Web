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
    career,
    time: 0,
    shockTimer: 0,
    banner: { text: '', color: '#fff', timer: 0 },
    tireMarks: [],
    tireBurst: 0,
    prevSpeed: 0,
    prevOffRoad: false,
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
    state.tireMarks = [];
    state.tireBurst = 0;
    state.prevSpeed = 0;
    state.prevOffRoad = false;
    state.shockTimer = 0;
    state.banner.timer = 0;
    state.paused = false;
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

    RR.Car.update(state.car, dt, input, mods);
    RR.Traffic.update(state.traffic, dt, state.car, npcScale);

    const passThrough = RR.Powerups.isJumping(state.powerups) ||
                        RR.Powerups.isInvincible(state.powerups);
    const hit = passThrough ? null
      : RR.Traffic.checkCollisions(state.traffic, state.car, inRR);

    // Coffee scales every rage gain (contact, brake, cut-ins, getting passed)
    // by 1.5x; drains are unaffected.
    const coffeeMult = RR.Powerups.isCoffee(state.powerups)
      ? RR.Config.RAGE.coffeeGainMult : 1;

    if (hit) {
      RR.Career.addDamage(state.career, hit.kind);
      RR.Rage.onHit(state.rage, hit.kind, coffeeMult);
    }
    RR.Rage.update(state.rage, dt, state.car, state.traffic, input, coffeeMult);
    RR.Powerups.update(state.powerups, dt, state.car, state.rage);

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
      const result = RR.Career.finishShift(
        state.career,
        state.rage.level,
        RR.Rage.isRoadRage(state.rage),
      );
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
    const r = RR.Config.ROAD;
    const halfW = RR.Config.CAR.width / 2;
    const normalLeft  = r.x + 2 + halfW;
    const normalRight = r.x + r.width - 2 - halfW;
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
    RR.Render.drawRoad(ctx, state.worldOffset);
    RR.Render.drawShoulderStrips(ctx, state.powerups);
    RR.Render.drawTireMarks(ctx, state.tireMarks);
    RR.Powerups.draw(ctx, state.powerups);
    RR.Traffic.draw(ctx, state.traffic);
    RR.Render.drawCar(ctx, state.car, RR.Rage.isRoadRage(state.rage),
                      RR.Powerups.jumpHeight(state.powerups),
                      RR.Powerups.invincibleRemaining(state.powerups));
    RR.Render.drawCoffeeVignette(ctx, state.powerups, state.time);
    RR.Render.drawRoadRageVignette(ctx, state.rage, state.time);
    RR.Render.drawShortcutFlash(ctx, state.shockTimer);
    RR.Render.drawHUD(ctx, state, state.time);
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
