// Road hazards. Pass C is a single shared "pothole" wired into every map;
// later passes can layer in per-map types (oil slicks, debris, barrels) by
// extending the spawn roster and the draw switch.
//
// State: { mapType, hazards: [{type, x, y}], spawnCooldown }
//
// Hits resolve in main.js parallel to traffic collisions: small rage bump,
// damage tick, speed kick, and a brief screen shake. Hazards never trigger
// Road Rage on their own (rage.onHit gates that for 'pothole').
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

  function pickSpawnX(road) {
    if (road) {
      const centers = RR.Road.laneCenters(road);
      return centers[Math.floor(Math.random() * centers.length)];
    }
    const r = C.ROAD;
    const lane = Math.floor(Math.random() * r.lanes);
    return r.x + (r.width / r.lanes) * (lane + 0.5);
  }

  function trySpawn(h, road) {
    h.hazards.push({
      type: 'pothole',
      x: pickSpawnX(road),
      y: C.HAZARDS.spawnAheadY,
    });
  }

  function update(h, dt, car, road) {
    for (const it of h.hazards) it.y += car.speed * dt;
    h.hazards = h.hazards.filter(it => it.y < C.INTERNAL_HEIGHT + 16);

    h.spawnCooldown -= dt;
    if (h.spawnCooldown <= 0) {
      trySpawn(h, road);
      const intervals = C.HAZARDS.pothole.interval;
      const [lo, hi] = intervals[h.mapType] || intervals.suburb;
      h.spawnCooldown = lo + Math.random() * (hi - lo);
    }
  }

  // Returns { kind, cfg } on hit (consumed), or null. Mirrors traffic's
  // checkCollisions signature so main.js can resolve both with parallel paths.
  function checkCollisions(h, car) {
    if (car.stunnedTimer > 0) return null;
    const cfg = C.HAZARDS.pothole;
    const rW = (C.CAR.width + cfg.width) / 2 - 2;
    const rH = (C.CAR.height + cfg.height) / 2 - 2;
    for (let i = h.hazards.length - 1; i >= 0; i--) {
      const it = h.hazards[i];
      if (Math.abs(it.x - car.x) < rW && Math.abs(it.y - car.y) < rH) {
        h.hazards.splice(i, 1);
        return { kind: 'pothole', cfg };
      }
    }
    return null;
  }

  function draw(ctx, h) {
    const cfg = C.HAZARDS.pothole;
    const w = cfg.width, hH = cfg.height;
    for (const it of h.hazards) {
      const x = Math.round(it.x - w / 2);
      const y = Math.round(it.y - hH / 2);
      // Outer rim — slightly lighter so the hole reads against asphalt.
      ctx.fillStyle = '#222222';
      ctx.fillRect(x, y, w, hH);
      // Inner shadow.
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(x + 2, y + 1, w - 4, hH - 2);
      // Tiny rim highlight on top edge for shape.
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(x + 2, y, w - 4, 1);
    }
  }

  return { create, update, draw, checkCollisions };
})();
