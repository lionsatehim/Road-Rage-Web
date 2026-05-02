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

  // The variable-lane road is owned by RR.Road; when present we read live
  // lane centers from it. Falls back to the static C.ROAD config when no
  // road has been built (e.g. in early-boot dev contexts).
  function laneCenters(road) {
    if (road) return RR.Road.laneCenters(road);
    const r = C.ROAD;
    const laneW = r.width / r.lanes;
    const out = [];
    for (let i = 0; i < r.lanes; i++) out.push(r.x + laneW * (i + 0.5));
    return out;
  }

  function nearestLane(x, road) {
    if (road) return RR.Road.nearestLane(road, x);
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

  function trySpawn(traffic, player, road) {
    const playerMax = C.CAR.maxSpeed;
    const archKey = rollArchetype();
    const archCfg = C.TRAFFIC.archetypes[archKey];
    const frac = archCfg.speedFrac[0] + Math.random() *
                 (archCfg.speedFrac[1] - archCfg.speedFrac[0]);
    const speed = playerMax * frac;

    const fasterThanPlayer = speed > player.speed + 8;
    const spawnY = fasterThanPlayer ? C.INTERNAL_HEIGHT + 30 : -30;

    const centers = laneCenters(road).slice();
    for (let i = centers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [centers[i], centers[j]] = [centers[j], centers[i]];
    }

    for (const lx of centers) {
      if (!laneClearAt(traffic.npcs, lx, spawnY, C.TRAFFIC.minLaneSeparation)) continue;

      // Vehicle class drives the sprite + tint pool. Sheet override (if
      // loaded) takes precedence; otherwise we fall back to the procedural
      // variant pool indexed by tintIdx.
      const vehicleClass = archCfg.sportSprite ? 'sport' : 'sedan';
      const tintCount = RR.Sprites.vehicleSheetExists(vehicleClass)
        ? RR.Sprites.vehicleTintCount(vehicleClass)
        : RR.Sprites.proceduralTintCount(vehicleClass);
      const tintIdx = Math.floor(Math.random() * Math.max(1, tintCount));
      // Souped-up coupes merge sharper than ordinary lane-changers — short
      // approach time so a pass attempt commits decisively.
      const baseLaneRate = archCfg.sportSprite
        ? (3.5 + Math.random() * 1.0)
        : (1.8 + Math.random() * 1.2);
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
        laneChangeRate: baseLaneRate,
        vehicleClass,
        tintIdx,
        // Damage frame index into the loaded sheet. NPCs spawn pristine
        // (frame 0) and flip to the wrecked frame on crash via
        // resolveCollision. Sheets without a load do nothing with this.
        damageFrame: 0,
        braking: false,
        // Blinker state: 0 = off, -1 = left, +1 = right. Driven by lane-change
        // intent, with an occasional random "they forgot to turn it off" tick.
        blinkerSide: 0,
        blinkerRandomTimer: 4 + Math.random() * 12,
        blinkerRandomActive: 0,
      };
      RR.Rage.tagSpawn(npc, player);
      traffic.npcs.push(npc);
      return true;
    }
    return false;
  }

  // ----- Per-archetype lateral & event behavior (no direct speed work) -----
  function archetypeUpdate(npc, dt, player, npcs, road) {
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
          const target = nearestLane(player.x, road);
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
          const centers = laneCenters(road);
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

      case 'soupedUp': {
        // Aggressive passer: as soon as any car (NPC or player) is close
        // ahead in the same lane, look for an open adjacent lane and merge.
        // Short cooldown between merge attempts so the coupe will weave
        // through traffic rather than settle into one lane.
        if (npc.timer > 0) {
          npc.timer -= dt;
        } else {
          const ahead = aheadInLane(npcs, npc);
          let blockDy = ahead ? ahead.dy : Infinity;
          if (Math.abs(player.x - npc.x) < SAME_LANE_DX) {
            const dy = npc.y - player.y;
            if (dy > 0 && dy < blockDy) blockDy = dy;
          }
          if (blockDy < 90) {
            const centers = laneCenters(road);
            let curIdx = 0, bestDx = Infinity;
            for (let i = 0; i < centers.length; i++) {
              const d = Math.abs(centers[i] - npc.targetX);
              if (d < bestDx) { bestDx = d; curIdx = i; }
            }
            const order = Math.random() < 0.5 ? [-1, 1] : [1, -1];
            for (const dir of order) {
              const idx = curIdx + dir;
              if (idx < 0 || idx >= centers.length) continue;
              const target = centers[idx];
              if (laneClearAt(npcs, target, npc.y, 60) &&
                  !playerInLane(player, target, npc.y, 50)) {
                npc.targetX = target;
                npc.timer = 0.6 + Math.random() * 0.6;
                break;
              }
            }
          }
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
    npc.braking = false;
    if (npc.brakeTimer > 0) {
      npc.brakeTimer -= dt;
      npc.speed = npc.baseSpeed * 0.25;
      npc.braking = true;
      return;
    }

    const lead = findLead(npc, npcs, player);
    if (lead) {
      const minGap = C.TRAFFIC.followBuffer;
      const decel  = C.TRAFFIC.npcBrakeDecel;

      if (lead.dy < minGap) {
        // Inside the buffer: clamp at or just under the lead's speed.
        const newSpeed = Math.max(0, Math.min(npc.speed, lead.speed - 4));
        if (newSpeed < npc.speed - 0.1) npc.braking = true;
        npc.speed = newSpeed;
        return;
      }

      const relSpeed = npc.speed - lead.speed;
      if (relSpeed > 0) {
        const stoppingDist = (relSpeed * relSpeed) / (2 * decel);
        const brakeAt = minGap + stoppingDist + 10;   // small safety margin
        if (lead.dy < brakeAt) {
          npc.speed = Math.max(lead.speed, npc.speed - decel * dt);
          npc.braking = true;
          return;
        }
      }
    }

    // Free road: recover toward base speed.
    if (npc.speed < npc.baseSpeed) {
      npc.speed = Math.min(npc.baseSpeed, npc.speed + 50 * dt);
    }
  }

  // Blinker side from lane-change intent (mid-merge) plus an occasional
  // "left it on" random burst — feels more human than perfect signaling.
  function updateBlinker(npc, dt) {
    const dx = npc.targetX - npc.x;
    const merging = Math.abs(dx) > 1.5;
    if (merging) {
      npc.blinkerSide = dx < 0 ? -1 : 1;
      npc.blinkerRandomActive = 0;
      return;
    }
    if (npc.blinkerRandomActive > 0) {
      npc.blinkerRandomActive -= dt;
      if (npc.blinkerRandomActive <= 0) {
        npc.blinkerSide = 0;
        npc.blinkerRandomTimer = 6 + Math.random() * 14;
      }
      return;
    }
    npc.blinkerSide = 0;
    npc.blinkerRandomTimer -= dt;
    if (npc.blinkerRandomTimer <= 0) {
      npc.blinkerRandomActive = 1.5 + Math.random() * 2.5;
      npc.blinkerSide = Math.random() < 0.5 ? -1 : 1;
    }
  }

  function update(traffic, dt, player, npcScale, road) {
    if (npcScale === undefined) npcScale = 1;
    const npcDt = dt * npcScale;

    // Re-pin every NPC against the road geometry at its OWN worldY, not the
    // player's. During lane transitions the road's lane centers and edges
    // differ along the screen — using the NPC's worldY keeps it riding the
    // current asphalt instead of briefly drifting onto the shoulder.
    if (road) {
      const halfW = C.CAR.width / 2;
      for (const npc of traffic.npcs) {
        if (npc.crashed) continue;
        const npcWy = road.worldOffset + (C.CAR.screenY - npc.y);
        const centers = RR.Road.laneCentersAt(road, npcWy);
        // Snap targetX to the closest valid lane center at this row.
        let bestIdx = 0, bestD = Infinity;
        for (let i = 0; i < centers.length; i++) {
          const d = Math.abs(centers[i] - npc.targetX);
          if (d < bestD) { bestD = d; bestIdx = i; }
        }
        npc.targetX = centers[bestIdx];
        // Clamp the NPC's x to the visible road at its worldY, so a
        // shrinking edge can't leave the NPC sitting on the grass.
        const edges = RR.Road.edgesAt(road, npcWy);
        const minX = edges.left  + halfW + 2;
        const maxX = edges.right - halfW - 2;
        if (npc.x < minX) npc.x = minX;
        if (npc.x > maxX) npc.x = maxX;
      }
    }

    for (const npc of traffic.npcs) {
      if (!npc.crashed) {
        archetypeUpdate(npc, npcDt, player, traffic.npcs, road);
        updateSpeed(npc, npcDt, traffic.npcs, player);
        updateBlinker(npc, dt);
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
      const spawned = trySpawn(traffic, player, road);
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
      npc.damageFrame = RR.Sprites.wreckedFrame(npc.vehicleClass);
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
    npc.damageFrame = RR.Sprites.wreckedFrame(npc.vehicleClass);

    for (let i = traffic.npcs.length - 1; i >= 0; i--) {
      const o = traffic.npcs[i];
      if (o === npc) continue;
      if (o.y > player.y + 4) traffic.npcs.splice(i, 1);
    }

    return { kind: 'crash', severity };
  }

  function draw(ctx, traffic) {
    // Blinkers blink at ~3 Hz off a shared clock so all signaling NPCs
    // are visually in sync — easier to read than per-car phase offsets.
    const blinkOn = (Math.floor(performance.now() / 220) % 2) === 0;
    for (const npc of traffic.npcs) {
      const x = Math.round(npc.x - C.CAR.width  / 2);
      const y = Math.round(npc.y - C.CAR.height / 2);
      const sprite = RR.Sprites.getNpcSprite(npc.vehicleClass, npc.tintIdx, npc.damageFrame);
      if (sprite) ctx.drawImage(sprite, x, y);
      if (!npc.crashed) {
        RR.Render.drawBrakeLights(ctx, x, y, npc.braking);
        if (npc.blinkerSide && blinkOn) {
          RR.Render.drawBlinker(ctx, x, y, npc.blinkerSide);
        }
      }
    }
  }

  return { create, update, checkCollisions, draw };
})();
