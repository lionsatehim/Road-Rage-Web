// Power-ups: roadside pickups, single-slot inventory, timed effects.
//
// State shape:
//   pickups[]:    { type, x, y }                — items on the road
//   inventory:    string | null                  — held type (one slot)
//   active:       { type, timer, cfg } | null    — currently running effect
//
// Stacking rule: at most one held in inventory at any time. Picking up a new
// item replaces whatever was queued (the old one is discarded). An active
// effect runs independently — collecting while an effect is running queues
// the new item, and Space activates it once the current effect expires.
window.RR = window.RR || {};

RR.Powerups = (function () {
  const C = RR.Config;

  function create() {
    return {
      pickups: [],
      inventory: null,
      active: null,
      spawnCooldown: 2.0,
      // Brief post-jump grace window — collisions ignored, car is set down on
      // top of any car it landed on instead of crashing.
      invincibleTimer: 0,
      // Smoothed NPC time scale. Eases toward coffee.npcTimeScale on activation
      // and back to 1 on expiry so traffic doesn't snap to a new speed.
      npcScaleSmoothed: 1,
      // Smoothed shoulder slack (px). Eases toward coffee.shoulderExtra while
      // active and back to 0 after — paired with exitGrace invincibility so
      // the player isn't punished if coffee ends while they're off-road.
      shoulderSlack: 0,
      // Single-frame flags for SFX dispatch.
      justCollected: false,
      justActivated: null,
      justExpired: null,
    };
  }

  function rollType() {
    const types = C.POWERUPS.types;
    const keys = Object.keys(types);
    let total = 0;
    for (const k of keys) total += types[k].weight;
    let v = Math.random() * total;
    for (const k of keys) {
      v -= types[k].weight;
      if (v <= 0) return k;
    }
    return keys[0];
  }

  // Lane center, but allow roadside placement too. For now, drop pickups in
  // a random lane center so the player has to commit to a lane to grab one.
  // Reads live lane geometry from the road when present (variable lanes).
  function pickSpawnX(road) {
    if (road) {
      const centers = RR.Road.laneCenters(road);
      return centers[Math.floor(Math.random() * centers.length)];
    }
    const r = C.ROAD;
    const laneW = r.width / r.lanes;
    const lane = Math.floor(Math.random() * r.lanes);
    return r.x + laneW * (lane + 0.5);
  }

  function trySpawn(p, road) {
    p.pickups.push({
      type: rollType(),
      x: pickSpawnX(road),
      y: C.POWERUPS.spawnAheadY,
    });
  }

  function update(p, dt, car, rage, road) {
    p.justCollected = false;
    p.justActivated = null;
    p.justExpired = null;

    if (p.active) {
      p.active.timer -= dt;
      p.active.elapsed += dt;
      if (p.active.timer <= 0) {
        p.justExpired = p.active.type;
        // exitGrace: short invincibility window after expiry. Used by jump
        // (slide off a car you land on) and coffee (don't punish the player
        // while the shoulder slack eases back to zero).
        if (p.active.cfg.exitGrace) {
          p.invincibleTimer = Math.max(p.invincibleTimer, p.active.cfg.exitGrace);
        }
        p.active = null;
      } else if (p.active.type === 'lofi' && rage) {
        rage.level = Math.max(0, rage.level - p.active.cfg.drainRate * dt);
      }
    }
    if (p.invincibleTimer > 0) {
      p.invincibleTimer = Math.max(0, p.invincibleTimer - dt);
    }

    // Smooth NPC time scale toward target so coffee eases in/out.
    const target = isCoffee(p) ? p.active.cfg.npcTimeScale : 1;
    const k = 1 - Math.exp(-5 * dt);
    p.npcScaleSmoothed += (target - p.npcScaleSmoothed) * k;

    // Shoulder slack eases on its own slower curve so the car is gently
    // pulled back to the lane after coffee ends instead of snapping.
    const slackTarget = isCoffee(p) ? (p.active.cfg.shoulderExtra || 0) : 0;
    const ks = 1 - Math.exp(-3 * dt);
    p.shoulderSlack += (slackTarget - p.shoulderSlack) * ks;
    if (p.shoulderSlack < 0.1 && slackTarget === 0) p.shoulderSlack = 0;

    // Activation: Space consumes inventory.
    if (RR.Input.consumeEdge('Space') && p.inventory && !p.active) {
      activate(p, p.inventory, car);
      p.inventory = null;
    }

    // Pickups drift with the player's real speed — coffee no longer slows
    // the world for the player, only NPCs.
    for (const it of p.pickups) it.y += car.speed * dt;
    p.pickups = p.pickups.filter(it => it.y < C.INTERNAL_HEIGHT + 20);

    // Collect on overlap.
    if (car.stunnedTimer <= 0) {
      const rW = (C.CAR.width + C.POWERUPS.pickupW) / 2 - 2;
      const rH = (C.CAR.height + C.POWERUPS.pickupH) / 2 - 2;
      for (let i = p.pickups.length - 1; i >= 0; i--) {
        const it = p.pickups[i];
        if (Math.abs(it.x - car.x) < rW && Math.abs(it.y - car.y) < rH) {
          p.inventory = it.type;
          p.pickups.splice(i, 1);
          p.justCollected = true;
          break;
        }
      }
    }

    p.spawnCooldown -= dt;
    if (p.spawnCooldown <= 0) {
      trySpawn(p, road);
      const [lo, hi] = C.POWERUPS.spawnInterval;
      p.spawnCooldown = lo + Math.random() * (hi - lo);
    }
  }

  function activate(p, type, car) {
    const cfg = C.POWERUPS.types[type];
    p.justActivated = type;

    if (type === 'shortcut') {
      // Instant: clear NPCs ahead, advance world.
      // Main wires this via the activation flag (it has access to traffic).
      return;
    }
    p.active = { type, timer: cfg.duration, elapsed: 0, cfg };

    if (type === 'jump') {
      // Visual hop: drawn by render via active.timer.
      // Pass-through is implemented in traffic collision check via mods.
    }
  }

  // Mods exposed to Car. Coffee sharpens accel + steering while active; the
  // shoulder slack lingers a bit past expiry so the lane re-clamp eases in.
  function carMods(p) {
    const out = {};
    let any = false;
    if (p.active && p.active.type === 'coffee') {
      out.steerBoost = p.active.cfg.steerBoost;
      out.accelBoost = p.active.cfg.accelBoost;
      any = true;
    }
    if (p.active && p.active.type === 'lofi' && p.active.cfg.maxSpeedMph) {
      out.maxSpeedAbs = p.active.cfg.maxSpeedMph / C.CAR.mphFactor;
      any = true;
    }
    if (p.shoulderSlack > 0.5) {
      out.shoulderExtra = p.shoulderSlack;
      any = true;
    }
    return any ? out : null;
  }

  // NPC time scale. 1 normally; eased toward coffee.npcTimeScale while active.
  function npcTimeScale(p) {
    return p.npcScaleSmoothed;
  }

  // 0..1 envelope for steady amber vignette while coffee is active.
  // 250ms fade-in, full hold, 400ms fade-out.
  function coffeeEnvelope(p) {
    if (!p.active || p.active.type !== 'coffee') return 0;
    const a = p.active;
    const fadeIn  = Math.min(1, a.elapsed / 0.25);
    const fadeOut = Math.min(1, a.timer / 0.4);
    return Math.min(fadeIn, fadeOut);
  }

  // Brief activation punch: stronger flash for ~0.6s on coffee start so the
  // user notices the world about to slow, decays exponentially.
  function coffeePunch(p) {
    if (!p.active || p.active.type !== 'coffee') return 0;
    return Math.exp(-p.active.elapsed / 0.25) * (p.active.elapsed < 0.6 ? 1 : 0);
  }

  function isJumping(p) {
    return p.active && p.active.type === 'jump';
  }

  function isInvincible(p) {
    return p.invincibleTimer > 0;
  }

  function invincibleRemaining(p) {
    return p.invincibleTimer;
  }

  function isCoffee(p) {
    return p.active && p.active.type === 'coffee';
  }

  function activeRemaining(p) {
    if (!p.active) return 0;
    return Math.max(0, p.active.timer);
  }

  function jumpHeight(p) {
    if (!isJumping(p)) return 0;
    const a = p.active;
    const t = 1 - (a.timer / a.cfg.duration);     // 0..1
    return Math.sin(t * Math.PI) * a.cfg.hopHeight;
  }

  function draw(ctx, p) {
    for (const it of p.pickups) {
      const sprite = RR.Sprites.PICKUPS[it.type];
      if (!sprite) continue;
      const x = Math.round(it.x - sprite.width  / 2);
      const y = Math.round(it.y - sprite.height / 2);
      ctx.drawImage(sprite, x, y);
    }
  }

  function shoulderSlack(p) { return p.shoulderSlack || 0; }

  return {
    create, update, draw,
    carMods, npcTimeScale,
    isJumping, jumpHeight, isCoffee, activeRemaining,
    isInvincible, invincibleRemaining,
    coffeeEnvelope, coffeePunch, shoulderSlack,
  };
})();
