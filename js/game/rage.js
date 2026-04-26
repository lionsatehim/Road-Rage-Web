// Rage meter and Road Rage mode.
//
// Rage is a 0..100 scalar driven by traffic events and player actions.
// Hits 100 → Road Rage mode for ~10s: top-speed boost, twitchier steering,
// the player can ram NPCs aside, and rage passively drains. Coming out
// drops rage to 30 so the next escalation takes work.
//
// Pass / passed-by detection uses each NPC's wasAhead flag — no Sets, so
// state is automatically cleaned up when NPCs despawn.
window.RR = window.RR || {};

RR.Rage = (function () {
  const C = RR.Config;

  function create() {
    return {
      level: 0,
      hornCooldown: 0,
      roadRageTimer: 0,        // > 0 ⇒ in Road Rage
      justEnteredRR: false,    // single-frame flags consumed by SFX dispatch
      justExitedRR: false,
      justHorn: false,
      justHornMash: false,
      justPassedCount: 0,
      justNearMiss: false,
    };
  }

  function isRoadRage(rage) { return rage.roadRageTimer > 0; }

  function add(rage, amount) {
    rage.level = Math.max(0, Math.min(100, rage.level + amount));
  }

  // Called on a hard crash from traffic.js
  function onHardCrash(rage) { add(rage, C.RAGE.crashBump); }

  // Mark NPC's initial wasAhead state at spawn — called from traffic.js
  function tagSpawn(npc, player) {
    npc.wasAhead = npc.y < player.y;
    npc.wasNearMiss = false;
  }

  function update(rage, dt, car, traffic, input) {
    rage.justEnteredRR = false;
    rage.justExitedRR = false;
    rage.justHorn = false;
    rage.justHornMash = false;
    rage.justPassedCount = 0;
    rage.justNearMiss = false;

    if (rage.hornCooldown > 0) rage.hornCooldown -= dt;

    // While stunned, freeze rage logic (don't double-punish a crash).
    if (car.stunnedTimer > 0) return;

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

    // ---- Slow-driving rage gain ----
    const speedFrac = car.speed / C.CAR.maxSpeed;
    if (speedFrac < C.RAGE.slowSpeedThreshold && !isRoadRage(rage)) {
      const slowness = (C.RAGE.slowSpeedThreshold - speedFrac) /
                       C.RAGE.slowSpeedThreshold;          // 0..1
      add(rage, C.RAGE.slowGain * slowness * dt);
    }

    // ---- Hard-braking rage gain ----
    if (input.brake && car.speed > 40 && !isRoadRage(rage)) {
      add(rage, C.RAGE.brakeGain * dt);
    }

    // ---- Smooth high-speed drain ----
    if (speedFrac > C.RAGE.smoothSpeedThreshold && !isRoadRage(rage)) {
      add(rage, -C.RAGE.smoothDrain * dt);
    }

    // ---- Pass / passed-by / near-miss tracking ----
    for (const npc of traffic.npcs) {
      if (npc.crashed) { npc.wasAhead = npc.y < car.y; continue; }
      const isAhead = npc.y < car.y;

      if (isAhead !== npc.wasAhead) {
        if (isAhead && car.speed > npc.speed) {
          // Player passed this NPC.
          const dx = Math.abs(npc.x - car.x);
          const closeness = Math.max(0, 1 - dx / 30);
          add(rage, -(C.RAGE.passBase + C.RAGE.passCloseBonus * closeness));
          rage.justPassedCount++;
        } else if (!isAhead && npc.speed > car.speed) {
          // NPC passed the player.
          add(rage, C.RAGE.passedBy);
        }
        npc.wasAhead = isAhead;
      }

      // Near-miss: close x and y, but not a pass crossing.
      const dx = Math.abs(npc.x - car.x);
      const dy = Math.abs(npc.y - car.y);
      if (!npc.wasNearMiss && dx < C.RAGE.nearMissDx && dy < C.RAGE.nearMissDy &&
          dx > 14) {
        npc.wasNearMiss = true;
        add(rage, C.RAGE.nearMiss);
        rage.justNearMiss = true;
      } else if (npc.wasNearMiss &&
                 (dx > C.RAGE.nearMissClearDx || dy > C.RAGE.nearMissClearDy)) {
        npc.wasNearMiss = false;
      }
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
        add(rage, C.RAGE.hornMashGain);
        rage.justHornMash = true;
      }
    }

    // ---- Trigger Road Rage ----
    if (rage.level >= 100 && !isRoadRage(rage)) {
      rage.level = 100;
      rage.roadRageTimer = C.RAGE.roadRageDuration;
      rage.justEnteredRR = true;
    }
  }

  return { create, update, isRoadRage, onHardCrash, tagSpawn };
})();
