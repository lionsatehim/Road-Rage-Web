// Bootstrap: fixed-timestep simulation (60Hz), decoupled rendering.
// For Layer 0 there is just one scene — drive on an empty road.
(function () {
  const C = RR.Config;
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Integer-scale the canvas to fill the window.
  function fitCanvas() {
    const sx = Math.floor(window.innerWidth  / C.INTERNAL_WIDTH);
    const sy = Math.floor(window.innerHeight / C.INTERNAL_HEIGHT);
    const scale = Math.max(1, Math.min(sx, sy));
    canvas.style.width  = (C.INTERNAL_WIDTH  * scale) + 'px';
    canvas.style.height = (C.INTERNAL_HEIGHT * scale) + 'px';
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  const state = {
    paused: false,
    car: RR.Car.create(),
    worldOffset: 0,
    traffic: RR.Traffic.create(),
    rage: RR.Rage.create(),
    powerups: RR.Powerups.create(),
    time: 0,
    shockTimer: 0,                    // shortcut lightning effect, decays
    banner: { text: '', color: '#fff', timer: 0 },   // power-up activation banner
    tireMarks: [],                    // {x,y,age,life} — fading smudges
    tireBurst: 0,                     // short window for transition/launch/skid bursts
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
    if (RR.Input.consumePause()) state.paused = !state.paused;
    if (RR.Input.consumeEdge('KeyM')) RR.Audio.toggleMuted();
    if (state.paused) return;
    const input = RR.Input.read();
    state.time += dt;

    const inRR = RR.Rage.isRoadRage(state.rage);
    const puMods = RR.Powerups.carMods(state.powerups);
    const mods = mergeMods(
      inRR ? {
        speedBoost: RR.Config.RAGE.roadRageSpeedBoost,
        steerBoost: RR.Config.RAGE.roadRageSteerBoost,
      } : null,
      puMods,
    );

    // Coffee no longer slows time for the player — only NPCs run on a scaled
    // dt. Player + road + rage all stay on real dt so the user feels faster.
    const npcScale = RR.Powerups.npcTimeScale(state.powerups);

    RR.Car.update(state.car, dt, input, mods);
    RR.Traffic.update(state.traffic, dt, state.car, npcScale);

    // Pass through traffic while airborne, plus a brief landing-grace window
    // so the player slides off a car they touch down on instead of crashing.
    const passThrough = RR.Powerups.isJumping(state.powerups) ||
                        RR.Powerups.isInvincible(state.powerups);
    const hit = passThrough ? null
      : RR.Traffic.checkCollisions(state.traffic, state.car, inRR);
    if (hit && hit.kind === 'crash') RR.Rage.onHardCrash(state.rage);
    RR.Rage.update(state.rage, dt, state.car, state.traffic, input);
    RR.Powerups.update(state.powerups, dt, state.car, state.rage);

    updateTireMarks(dt);

    // Shortcut: clear NPCs ahead, jump worldOffset forward, trigger flash.
    if (state.powerups.justActivated === 'shortcut') {
      const advance = RR.Config.POWERUPS.types.shortcut.advance;
      state.worldOffset += advance;
      state.traffic.npcs = state.traffic.npcs.filter(n => n.y > state.car.y);
      state.shockTimer = 1.0;
    }
    if (state.shockTimer > 0) state.shockTimer = Math.max(0, state.shockTimer - dt);
    if (state.banner.timer > 0) state.banner.timer = Math.max(0, state.banner.timer - dt);

    state.worldOffset += state.car.speed * dt;

    // ---- Audio ----
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

  // Tire marks emit only on specific events — not continuously on asphalt:
  //   1. while currently off-road
  //   2. brief burst on returning from off-road to asphalt (regaining grip)
  //   3. brief burst on a sudden acceleration (launch)
  //   4. brief burst on a sudden brake/stop (skid)
  // Marks drift down-screen with the world and fade over their lifespan.
  function updateTireMarks(dt) {
    const car = state.car;
    const r = RR.Config.ROAD;
    const halfW = RR.Config.CAR.width / 2;
    // Off-road = car center past the *normal* clamp bound, regardless of any
    // coffee shoulder slack (we want true asphalt, not the temporary zone).
    const normalLeft  = r.x + 2 + halfW;
    const normalRight = r.x + r.width - 2 - halfW;
    const offRoad = car.x < normalLeft - 0.5 || car.x > normalRight + 0.5;

    const rate = (car.speed - state.prevSpeed) / Math.max(dt, 1e-6);

    if (!offRoad) {
      if (state.prevOffRoad) {
        state.tireBurst = Math.max(state.tireBurst, 0.25);
      }
      // Hard brake on asphalt: skid marks. brake decel is 280, so anything
      // below that in rate means more than just idle decel — actually pressing.
      if (rate < -240 && car.speed > 30) {
        state.tireBurst = Math.max(state.tireBurst, 0.18);
      }
      // Launch from low speed: burnout. Only counts when there's still room
      // to climb — at top speed there's no "sudden" left to give.
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
    state.banner.timer = 1.23;   // matches drawBanner envelope
  }

  function mergeMods(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      speedBoost: (a.speedBoost || 1) * (b.speedBoost || 1),
      steerBoost: (a.steerBoost || 1) * (b.steerBoost || 1),
      accelBoost: (a.accelBoost || 1) * (b.accelBoost || 1),
    };
  }

  function draw() {
    RR.Render.clear(ctx);
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
    if (state.paused) RR.Render.drawPause(ctx);
  }

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
})();
