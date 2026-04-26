// Traffic: spawning, archetype behavior, NPC-NPC avoidance, collisions.
//
// Vertical drift on screen = playerSpeed - npcSpeed: faster NPCs drift up,
// slower ones drift down past the (stationary on screen) player.
window.RR = window.RR || {};

RR.Traffic = (function () {
  const C = RR.Config;
  const SAME_LANE_DX = 12;   // |dx| below this counts as "same lane" for ahead-checks

  function create() {
    return { npcs: [], spawnCooldown: 0.4 };
  }

  function laneCenters() {
    const r = C.ROAD;
    const laneW = r.width / r.lanes;
    const out = [];
    for (let i = 0; i < r.lanes; i++) out.push(r.x + laneW * (i + 0.5));
    return out;
  }

  function nearestLane(x) {
    const centers = laneCenters();
    let best = centers[0], bd = Infinity;
    for (const c of centers) {
      const d = Math.abs(c - x);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function rollArchetype() {
    const arch = C.TRAFFIC.archetypes;
    const keys = Object.keys(arch);
    let total = 0;
    for (const k of keys) total += arch[k].weight;
    let v = Math.random() * total;
    for (const k of keys) {
      v -= arch[k].weight;
      if (v <= 0) return k;
    }
    return keys[0];
  }

  // Closest car directly ahead of `self` in the same x-band.
  // "Ahead" = smaller y (further up the screen), since the player drives upward.
  function aheadInLane(npcs, self) {
    let best = null, bestDy = Infinity;
    for (const o of npcs) {
      if (o === self) continue;
      if (Math.abs(o.x - self.x) > SAME_LANE_DX) continue;
      const dy = self.y - o.y;       // positive if `o` is ahead
      if (dy > 0 && dy < bestDy) { bestDy = dy; best = o; }
    }
    return best ? { npc: best, dy: bestDy } : null;
  }

  // Is the lane around `lx` clear within ±gap of `refY`?
  function laneClearAt(npcs, lx, refY, gap) {
    for (const o of npcs) {
      if (Math.abs(o.x - lx) < SAME_LANE_DX && Math.abs(o.y - refY) < gap) {
        return false;
      }
    }
    return true;
  }

  // Would merging into lane `lx` side-swipe the player? True if the player is
  // already in that lane within ±gap of the NPC's y. Used by lane-changing
  // archetypes to abort a merge that would T-bone or scrape the player.
  function playerInLane(player, lx, refY, gap) {
    return Math.abs(player.x - lx) < SAME_LANE_DX &&
           Math.abs(player.y - refY) < gap;
  }

  function trySpawn(traffic, player) {
    const playerMax = C.CAR.maxSpeed;
    const archKey = rollArchetype();
    const archCfg = C.TRAFFIC.archetypes[archKey];
    const frac = archCfg.speedFrac[0] + Math.random() *
                 (archCfg.speedFrac[1] - archCfg.speedFrac[0]);
    const speed = playerMax * frac;

    const fasterThanPlayer = speed > player.speed + 8;
    const spawnY = fasterThanPlayer ? C.INTERNAL_HEIGHT + 30 : -30;

    const centers = laneCenters().slice();
    for (let i = centers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [centers[i], centers[j]] = [centers[j], centers[i]];
    }

    for (const lx of centers) {
      if (!laneClearAt(traffic.npcs, lx, spawnY, C.TRAFFIC.minLaneSeparation)) continue;

      const variants = RR.Sprites.NPC_VARIANTS;
      const sprite = variants[Math.floor(Math.random() * variants.length)];
      const npc = {
        x: lx, y: spawnY,
        targetX: lx,
        speed: speed, baseSpeed: speed,
        archetype: archKey,
        timer: 1 + Math.random() * 2,
        brakeTimer: 0,
        crashed: false,
        // Per-NPC lateral approach rate for lane changes — randomized so
        // weavers/tailgaters don't all change lanes at the same brisk pace.
        laneChangeRate: 1.8 + Math.random() * 1.2,
        sprite: sprite,
      };
      RR.Rage.tagSpawn(npc, player);
      traffic.npcs.push(npc);
      return true;
    }
    return false;
  }

  // ----- Per-archetype lateral & event behavior (no direct speed work) -----
  function archetypeUpdate(npc, dt, player, npcs) {
    const approach = (rate) => 1 - Math.exp(-rate * dt);

    switch (npc.archetype) {
      case 'cruiser':
      case 'slowpoke':
        npc.x += (npc.targetX - npc.x) * approach(6);
        break;

      case 'tailgater': {
        // Cooldown between lane changes so tailgaters don't constantly track
        // every wiggle the player makes.
        if (npc.timer > 0) {
          npc.timer -= dt;
        } else if (Math.abs(npc.y - player.y) < 90) {
          const target = nearestLane(player.x);
          if (target !== npc.targetX &&
              laneClearAt(npcs, target, npc.y, 70) &&
              !playerInLane(player, target, npc.y, 50)) {
            npc.targetX = target;
            npc.timer = 2.0 + Math.random() * 2.0;
          }
        }
        npc.x += (npc.targetX - npc.x) * approach(npc.laneChangeRate);
        break;
      }

      case 'weaver': {
        npc.timer -= dt;
        if (npc.timer <= 0) {
          // Adjacent lanes only — one lane at a time.
          const centers = laneCenters();
          let curIdx = 0, bestDx = Infinity;
          for (let i = 0; i < centers.length; i++) {
            const d = Math.abs(centers[i] - npc.targetX);
            if (d < bestDx) { bestDx = d; curIdx = i; }
          }
          const adj = [];
          if (curIdx > 0) adj.push(centers[curIdx - 1]);
          if (curIdx < centers.length - 1) adj.push(centers[curIdx + 1]);
          if (adj.length > 1 && Math.random() < 0.5) adj.reverse();
          for (const c of adj) {
            if (laneClearAt(npcs, c, npc.y, 70) &&
                !playerInLane(player, c, npc.y, 50)) {
              npc.targetX = c;
              break;
            }
          }
          npc.timer = 3.0 + Math.random() * 3.0;
        }
        npc.x += (npc.targetX - npc.x) * approach(npc.laneChangeRate);
        break;
      }

      case 'brakeCheck': {
        if (npc.brakeTimer <= 0) {
          npc.timer -= dt;
          if (npc.timer <= 0) {
            npc.brakeTimer = 0.7;
            npc.timer = 4 + Math.random() * 4;
          }
        }
        npc.x += (npc.targetX - npc.x) * approach(6);
        break;
      }
    }
  }

  // Closest obstacle directly ahead — could be another NPC or the player.
  function findLead(npc, npcs, player) {
    let leadSpeed = Infinity;
    let leadDy = Infinity;

    const ahead = aheadInLane(npcs, npc);
    if (ahead) { leadSpeed = ahead.npc.speed; leadDy = ahead.dy; }

    if (Math.abs(player.x - npc.x) < SAME_LANE_DX) {
      const dy = npc.y - player.y;
      if (dy > 0 && dy < leadDy) { leadSpeed = player.speed; leadDy = dy; }
    }
    return leadDy < Infinity ? { speed: leadSpeed, dy: leadDy } : null;
  }

  // Speed brain. NPCs are perfect brakers — they compute the stopping distance
  // for their current relative speed and start decelerating before they could
  // possibly run into the lead car (NPC or player).
  function updateSpeed(npc, dt, npcs, player) {
    if (npc.brakeTimer > 0) {
      npc.brakeTimer -= dt;
      npc.speed = npc.baseSpeed * 0.25;
      return;
    }

    const lead = findLead(npc, npcs, player);
    if (lead) {
      const minGap = C.TRAFFIC.followBuffer;
      const decel  = C.TRAFFIC.npcBrakeDecel;

      if (lead.dy < minGap) {
        // Inside the buffer: clamp at or just under the lead's speed.
        npc.speed = Math.max(0, Math.min(npc.speed, lead.speed - 4));
        return;
      }

      const relSpeed = npc.speed - lead.speed;
      if (relSpeed > 0) {
        const stoppingDist = (relSpeed * relSpeed) / (2 * decel);
        const brakeAt = minGap + stoppingDist + 10;   // small safety margin
        if (lead.dy < brakeAt) {
          npc.speed = Math.max(lead.speed, npc.speed - decel * dt);
          return;
        }
      }
    }

    // Free road: recover toward base speed.
    if (npc.speed < npc.baseSpeed) {
      npc.speed = Math.min(npc.baseSpeed, npc.speed + 50 * dt);
    }
  }

  function update(traffic, dt, player, npcScale) {
    if (npcScale === undefined) npcScale = 1;
    const npcDt = dt * npcScale;
    for (const npc of traffic.npcs) {
      if (!npc.crashed) {
        archetypeUpdate(npc, npcDt, player, traffic.npcs);
        updateSpeed(npc, npcDt, traffic.npcs, player);
      }
      // Player drifts on real time; NPCs cover less ground when slowed.
      npc.y += (player.speed - npc.speed * npcScale) * dt;
    }
    traffic.npcs = traffic.npcs.filter(n =>
      n.y > -60 && n.y < C.INTERNAL_HEIGHT + 60
    );

    // Don't spawn while the player is stunned from a crash.
    if (player.stunnedTimer > 0) return;

    traffic.spawnCooldown -= dt;
    if (traffic.spawnCooldown <= 0 && traffic.npcs.length < C.TRAFFIC.spawnTarget) {
      const spawned = trySpawn(traffic, player);
      traffic.spawnCooldown = spawned ? (0.35 + Math.random() * 0.6) : 0.18;
    }
  }

  function checkCollisions(traffic, player, isRoadRage) {
    if (player.stunnedTimer > 0) return null;
    const w = C.CAR.width  - 2;
    const h = C.CAR.height - 4;
    for (const npc of traffic.npcs) {
      if (npc.crashed) continue;
      if (Math.abs(npc.x - player.x) < w && Math.abs(npc.y - player.y) < h) {
        return resolveCollision(player, npc, traffic, isRoadRage);
      }
    }
    return null;
  }

  function resolveCollision(player, npc, traffic, isRoadRage) {
    const t = C.TRAFFIC;
    const relSpeed = Math.abs(player.speed - npc.speed);
    const severity = Math.min(1, relSpeed / C.CAR.maxSpeed);
    const sideHit = Math.abs(npc.x - player.x) > Math.abs(npc.y - player.y);

    if (isRoadRage) {
      // Ram: knock the NPC aside, light speed loss, no stun.
      const dir = (npc.x >= player.x ? 1 : -1);
      npc.crashed = true;
      npc.speed = 0;
      npc.x += dir * 14;
      npc.y += 4;
      player.speed *= 0.9;
      return { kind: 'ram' };
    }

    if (severity < t.lightTapThreshold && sideHit) {
      // Glancing scrape — small speed loss + sideways knock, no stun.
      player.speed *= t.lightTapSpeedRetained;
      player.lateralVel = (npc.x > player.x ? -1 : 1) * t.lightTapKnock;
      npc.x += (npc.x > player.x ? 1 : -1) * 2;
      return { kind: 'tap' };
    }

    // Hard crash — both cars stop dead, "reset" period begins.
    player.speed = 0;
    player.lateralVel = 0;
    player.stunnedTimer = t.crashStunTime;

    npc.speed = 0;
    npc.crashed = true;

    for (let i = traffic.npcs.length - 1; i >= 0; i--) {
      const o = traffic.npcs[i];
      if (o === npc) continue;
      if (o.y > player.y + 4) traffic.npcs.splice(i, 1);
    }

    return { kind: 'crash', severity };
  }

  function draw(ctx, traffic) {
    for (const npc of traffic.npcs) {
      const x = Math.round(npc.x - C.CAR.width  / 2);
      const y = Math.round(npc.y - C.CAR.height / 2);
      ctx.drawImage(npc.sprite, x, y);
    }
  }

  return { create, update, checkCollisions, draw };
})();
