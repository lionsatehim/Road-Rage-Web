// Road hazards. Multiple types — pothole, water puddle, oil slick,
// construction cone — each with its own footprint, draw routine, and hit
// effect. Per-map rosters in C.HAZARDS.perMap pick which types appear and
// how often.
//
// State: { mapType, hazards: [{type, x, y}], spawnCooldown }
//
// Hits resolve in main.js parallel to traffic collisions: rage bump, damage,
// speed kick, optional lateral knock, and a brief screen shake. Hazards
// never trigger Road Rage (Rage.flatBump skips that path).
window.RR = window.RR || {};

RR.Hazards = (function () {
  const C = RR.Config;

  function create(mapType) {
    return {
      mapType: mapType || 'suburb',
      hazards: [],
      spawnCooldown: 1.5,
    };
  }

  function mapEntry(mapType) {
    return C.HAZARDS.perMap[mapType] || C.HAZARDS.perMap.suburb;
  }

  function rollType(roster) {
    let total = 0;
    for (const k in roster) total += roster[k];
    let v = Math.random() * total;
    for (const k in roster) {
      v -= roster[k];
      if (v <= 0) return k;
    }
    return Object.keys(roster)[0];
  }

  function pickLaneX(road) {
    if (road) {
      const centers = RR.Road.laneCenters(road);
      return centers[Math.floor(Math.random() * centers.length)];
    }
    const r = C.ROAD;
    const lane = Math.floor(Math.random() * r.lanes);
    return r.x + (r.width / r.lanes) * (lane + 0.5);
  }

  // Shoulder placement: just outside one of the visible road edges so the
  // car straddles the asphalt/grass line. Player only collides while
  // off-road (coffee shoulder slack, evasive swerve).
  function pickShoulderX(road, cfg) {
    const halfW = cfg.width / 2;
    const offset = halfW + 2;
    const left = Math.random() < 0.5;
    if (road) {
      return left ? road.leftEdge - offset : road.rightEdge + offset;
    }
    const r = C.ROAD;
    return left ? r.x - offset : r.x + r.width + offset;
  }

  function trySpawn(h, road) {
    const entry = mapEntry(h.mapType);
    const type = rollType(entry.roster);
    const cfg = C.HAZARDS.types[type];
    if (!cfg) return;
    const x = (cfg.placement === 'shoulder')
      ? pickShoulderX(road, cfg)
      : pickLaneX(road);
    const item = {
      type,
      x,
      y: C.HAZARDS.spawnAheadY,
    };
    // Pick a sprite once at spawn so the car keeps a consistent look.
    if (type === 'stoppedCar' && RR.Sprites && RR.Sprites.NPC_VARIANTS) {
      const variants = RR.Sprites.NPC_VARIANTS;
      item.sprite = variants[Math.floor(Math.random() * variants.length)];
    }
    h.hazards.push(item);
  }

  function update(h, dt, car, road) {
    for (const it of h.hazards) it.y += car.speed * dt;
    h.hazards = h.hazards.filter(it => it.y < C.INTERNAL_HEIGHT + 16);

    h.spawnCooldown -= dt;
    if (h.spawnCooldown <= 0) {
      trySpawn(h, road);
      const [lo, hi] = mapEntry(h.mapType).interval;
      h.spawnCooldown = lo + Math.random() * (hi - lo);
    }
  }

  // Returns { kind, cfg } on hit (consumed), or null. Hitbox uses each
  // type's own width/height so cones (small) and oil (wide) feel different.
  function checkCollisions(h, car) {
    if (car.stunnedTimer > 0) return null;
    for (let i = h.hazards.length - 1; i >= 0; i--) {
      const it = h.hazards[i];
      const cfg = C.HAZARDS.types[it.type];
      if (!cfg) continue;
      const rW = (C.CAR.width + cfg.width) / 2 - 2;
      const rH = (C.CAR.height + cfg.height) / 2 - 2;
      if (Math.abs(it.x - car.x) < rW && Math.abs(it.y - car.y) < rH) {
        h.hazards.splice(i, 1);
        return { kind: it.type, cfg };
      }
    }
    return null;
  }

  // -------- Procedural draw routines --------

  function drawPothole(ctx, cx, cy, cfg) {
    const w = cfg.width, hH = cfg.height;
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy - hH / 2);
    ctx.fillStyle = '#222222';
    ctx.fillRect(x, y, w, hH);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x + 2, y + 1, w - 4, hH - 2);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(x + 2, y, w - 4, 1);
  }

  function drawPuddle(ctx, cx, cy, cfg) {
    const w = cfg.width, hH = cfg.height;
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy - hH / 2);
    // Outer dark blue ring (rounded by trimming corners)
    ctx.fillStyle = '#1a3a5a';
    ctx.fillRect(x + 1, y, w - 2, hH);
    ctx.fillRect(x, y + 1, w, hH - 2);
    // Mid blue body
    ctx.fillStyle = '#2a5a80';
    ctx.fillRect(x + 2, y + 1, w - 4, hH - 2);
    ctx.fillStyle = '#3a7aa8';
    ctx.fillRect(x + 3, y + 2, w - 6, hH - 4);
    // Light shimmer streaks (top-left + bottom-right for a 3D feel)
    ctx.fillStyle = '#a0d8f0';
    ctx.fillRect(x + 4, y + 2, 4, 1);
    ctx.fillRect(x + w - 9, y + hH - 3, 5, 1);
  }

  function drawOil(ctx, cx, cy, cfg) {
    const w = cfg.width, hH = cfg.height;
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy - hH / 2);
    // Black slick base, slightly rounded
    ctx.fillStyle = '#0a0814';
    ctx.fillRect(x + 1, y, w - 2, hH);
    ctx.fillRect(x, y + 1, w, hH - 2);
    // Body
    ctx.fillStyle = '#1a1424';
    ctx.fillRect(x + 2, y + 1, w - 4, hH - 2);
    // Iridescent shimmer streaks (purple + teal)
    ctx.fillStyle = '#603870';
    ctx.fillRect(x + 3, y + 2, 5, 1);
    ctx.fillStyle = '#306060';
    ctx.fillRect(x + w - 8, y + hH - 4, 4, 1);
    ctx.fillStyle = '#503060';
    ctx.fillRect(x + 5, y + hH - 3, 3, 1);
  }

  function drawCone(ctx, cx, cy, cfg) {
    const w = cfg.width, hH = cfg.height;
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy - hH / 2);
    // Triangular cone body, narrower at top, plus a base.
    // Layout (10w x 12h):
    //   ...OO...  top
    //   ..OOOO..
    //   ..WWWW..  white reflective stripe
    //   .OOOOOO.
    //   .OOOOOO.
    //   .WWWWWW.  white reflective stripe
    //   OOOOOOOO
    //   OOOOOOOO
    //   OOOOOOOO
    //   OOOOOOOO
    //   GGGGGGGG  base
    //   GGGGGGGG
    const O = '#ff7020', W = '#f0f0f0', G = '#404048';
    ctx.fillStyle = O;
    ctx.fillRect(x + 3, y + 0, 4, 2);
    ctx.fillRect(x + 2, y + 2, 6, 1);
    ctx.fillRect(x + 1, y + 4, 8, 2);
    ctx.fillRect(x + 0, y + 6, 10, 4);
    ctx.fillStyle = W;
    ctx.fillRect(x + 2, y + 3, 6, 1);
    ctx.fillRect(x + 1, y + 6, 8, 1);
    ctx.fillStyle = G;
    ctx.fillRect(x + 0, y + 10, 10, 2);
  }

  function drawStoppedCar(ctx, it) {
    if (!it.sprite) return;
    const x = Math.round(it.x - C.CAR.width / 2);
    const y = Math.round(it.y - C.CAR.height / 2);
    ctx.drawImage(it.sprite, x, y);
    // Hazard flashers on the rear bumper — both tail lights blink in sync
    // at ~1.4 Hz. Reads as "broken-down, do not approach".
    const blinkOn = (Math.floor(performance.now() / 350) % 2) === 0;
    ctx.fillStyle = blinkOn ? '#ff4040' : '#601010';
    ctx.fillRect(x + 5, y + 21, 2, 2);
    ctx.fillRect(x + 9, y + 21, 2, 2);
  }

  function draw(ctx, h) {
    for (const it of h.hazards) {
      const cfg = C.HAZARDS.types[it.type];
      if (!cfg) continue;
      switch (it.type) {
        case 'pothole':    drawPothole(ctx, it.x, it.y, cfg); break;
        case 'puddle':     drawPuddle(ctx, it.x, it.y, cfg); break;
        case 'oil':        drawOil(ctx, it.x, it.y, cfg); break;
        case 'cones':      drawCone(ctx, it.x, it.y, cfg); break;
        case 'stoppedCar': drawStoppedCar(ctx, it); break;
      }
    }
  }

  return { create, update, draw, checkCollisions };
})();
