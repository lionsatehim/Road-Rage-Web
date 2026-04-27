// Rage meter and Road Rage mode.
//
// Rage is a 0..100 scalar — read as ten "ticks" of 10 each. Hits 100 → Road
// Rage mode for ~10s: top-speed boost, twitchier steering, the player can
// ram NPCs aside, and rage passively drains. Coming out drops rage to 30
// so the next escalation takes work.
//
// Sources of gain  (ticks): brake tap, brake held, contact (crash/tap),
//                            NPC merge into your lane ahead, NPC overtaking
//                            you on either side.
// Sources of drain (ticks): cruising at max speed, overtaking an NPC on
//                            either side, jump landing (-33%), shortcut
//                            (-75%), coffee activation (-20).
// Coffee multiplies every gain by 1.5 (drains are unaffected).
window.RR = window.RR || {};

RR.Rage = (function () {
  const C = RR.Config;

  function create() {
    return {
      level: 0,
      hornCooldown: 0,
      roadRageTimer: 0,        // > 0 ⇒ in Road Rage
      brakeHeldFor: 0,         // seconds the brake has been held this stretch
      // Single-frame flags consumed by SFX / banner dispatch.
      justEnteredRR: false,
      justEnteredFromCrash: false,
      justExitedRR: false,
      justHorn: false,
      justHornMash: false,
      justPassedCount: 0,
      justNearMiss: false,     // kept for SFX compatibility (unused gameplay-side)
    };
  }

  function isRoadRage(rage) { return rage.roadRageTimer > 0; }

  // Apply a delta. `mult` only scales positive gains (drains aren't boosted
  // by coffee). Tracks whether a positive bump actually pushed us into RR.
  function add(rage, amount, mult) {
    if (amount > 0) amount *= (mult || 1);
    const before = rage.level;
    rage.level = Math.max(0, Math.min(100, rage.level + amount));
    return { before, after: rage.level };
  }

  // Contact bump — crash or tap. Both add the same +50%. If this push is the
  // one that crosses the 100 threshold, flag justEnteredFromCrash so the UI
  // can call out that rage mode is now available.
  function onHit(rage, kind, mult) {
    let amount = 0;
    if (kind === 'crash' || kind === 'tap') amount = C.RAGE.crashBump;
    else if (kind === 'pothole') amount = C.RAGE.potholeBump;
    else return;
    const before = rage.level;
    add(rage, amount, mult);
    // Potholes don't auto-trigger RR mode — too cheesable as a self-trigger.
    if (kind !== 'pothole' && before < 100 && rage.level >= 100 && !isRoadRage(rage)) {
      rage.crashAboutToTriggerRR = true;
    }
  }

  // Multiplicative reduction (jump landing, shortcut). Clamped at 0.
  function reducePct(rage, pct) {
    if (!pct) return;
    rage.level = Math.max(0, rage.level * (1 - pct / 100));
  }

  // Flat reduction (coffee immediate drop).
  function reduceFlat(rage, amount) {
    rage.level = Math.max(0, rage.level - amount);
  }

  function tagSpawn(npc, player) {
    npc.wasAhead = npc.y < player.y;
    npc.wasInPlayerLane = sameLaneAs(npc, player);
    npc.wasNearMiss = false;
  }

  function sameLaneAs(npc, player) {
    return Math.abs(npc.x - player.x) < 12;
  }

  function update(rage, dt, car, traffic, input, gainMult) {
    rage.justEnteredRR = false;
    rage.justEnteredFromCrash = false;
    rage.justExitedRR = false;
    rage.justHorn = false;
    rage.justHornMash = false;
    rage.justPassedCount = 0;
    rage.justNearMiss = false;

    if (rage.hornCooldown > 0) rage.hornCooldown -= dt;

    // While stunned, freeze rage logic (don't double-punish a crash).
    if (car.stunnedTimer > 0) return;

    const mult = gainMult || 1;

    // ---- Road Rage tick ----
    if (rage.roadRageTimer > 0) {
      rage.roadRageTimer -= dt;
      add(rage, -C.RAGE.roadRageDrainRate * dt);
      if (rage.roadRageTimer <= 0) {
        rage.roadRageTimer = 0;
        rage.level = C.RAGE.roadRageExitLevel;
        rage.justExitedRR = true;
      }
    }

    // ---- Braking ----
    // Edge: tap penalty fires once when brake first goes down.
    if (input.brake) {
      if (rage.brakeHeldFor === 0) add(rage, C.RAGE.brakeTap, mult);
      rage.brakeHeldFor += dt;
      // Held: continuous gain after the initial tap.
      add(rage, C.RAGE.brakeHeldRate * dt, mult);
    } else {
      rage.brakeHeldFor = 0;
    }

    // ---- Cruising at max speed: drain ----
    const speedFrac = car.speed / C.CAR.maxSpeed;
    if (speedFrac >= C.RAGE.maxSpeedThreshold && !isRoadRage(rage)) {
      add(rage, -C.RAGE.maxSpeedDrain * dt);
    }

    // ---- NPC events: passes (both directions) + lane merges ----
    for (const npc of traffic.npcs) {
      // Track lateral motion so we can tell an NPC merging into your lane
      // apart from you swerving into theirs. Frame-to-frame x delta.
      const npcLateralMoving = npc.lastX !== undefined &&
                               Math.abs(npc.x - npc.lastX) > 0.3;
      npc.lastX = npc.x;

      if (npc.crashed) {
        npc.wasAhead = npc.y < car.y;
        npc.wasInPlayerLane = sameLaneAs(npc, car);
        continue;
      }
      const isAhead = npc.y < car.y;
      const inLane  = sameLaneAs(npc, car);

      // Pass / passed-by transitions: y crosses through player.
      if (isAhead !== npc.wasAhead) {
        const dx = Math.abs(npc.x - car.x);
        const onSide = dx < C.RAGE.sidePassDx;
        if (isAhead && car.speed > npc.speed) {
          if (onSide) {
            add(rage, -C.RAGE.sidePass);
            rage.justPassedCount++;
          }
        } else if (!isAhead && npc.speed > car.speed) {
          if (onSide) add(rage, C.RAGE.passedBy, mult);
        }
        npc.wasAhead = isAhead;
      }

      // NPC merging into your lane while ahead of you (someone cuts in).
      // Require the NPC itself to be laterally moving, so the player
      // swerving into a stationary NPC's lane doesn't trigger this.
      if (isAhead && inLane && !npc.wasInPlayerLane && npcLateralMoving) {
        add(rage, C.RAGE.npcMergeAhead, mult);
      }
      npc.wasInPlayerLane = inLane;
    }

    // ---- Horn ----
    const honked = RR.Input.consumeEdge('ShiftLeft') |
                   RR.Input.consumeEdge('ShiftRight');
    if (honked) {
      if (rage.hornCooldown <= 0) {
        add(rage, -C.RAGE.hornRelief);
        rage.hornCooldown = C.RAGE.hornCooldown;
        rage.justHorn = true;
      } else {
        add(rage, C.RAGE.hornMashGain, mult);
        rage.justHornMash = true;
      }
    }

    // ---- Trigger Road Rage ----
    if (rage.level >= 100 && !isRoadRage(rage)) {
      rage.level = 100;
      rage.roadRageTimer = C.RAGE.roadRageDuration;
      rage.justEnteredRR = true;
      if (rage.crashAboutToTriggerRR) rage.justEnteredFromCrash = true;
    }
    rage.crashAboutToTriggerRR = false;
  }

  // Back-compat shim: callers used to invoke onHardCrash() directly. Funnel
  // it through onHit('crash') so the new bump value applies.
  function onHardCrash(rage, mult) { onHit(rage, 'crash', mult); }

  return {
    create, update, isRoadRage,
    onHit, onHardCrash, tagSpawn,
    reducePct, reduceFlat,
  };
})();
