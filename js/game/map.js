// Map background. Paints the off-road area (ground tint + scrolling
// detail) and a stream of set-piece decorations alongside the road.
// The set-piece roster comes from RR.Config.MAPS keyed on mapType, which is
// chosen per career level. Decorations drift down with the player's speed
// (matching the NPC/pickup convention) so motion feels coherent.
window.RR = window.RR || {};

RR.Map = (function () {
  const C = RR.Config;

  function create(type) {
    const cfg = C.MAPS[type] || C.MAPS.suburb;
    return {
      type,
      cfg,
      decos: [],
      spawnCooldown: 0.4,
    };
  }

  function pickPiece(cfg) {
    let total = 0;
    for (const p of cfg.pieces) total += p.weight;
    let v = Math.random() * total;
    for (const p of cfg.pieces) {
      v -= p.weight;
      if (v <= 0) return p.name;
    }
    return cfg.pieces[0].name;
  }

  function spawnDeco(map, road) {
    const name = pickPiece(map.cfg);
    const sprite = RR.Sprites.MAP[name];
    if (!sprite) return;
    const W = C.INTERNAL_WIDTH;
    // Use the widest the road ever gets so a deco placed now isn't covered
    // by a later, wider segment scrolling onto it.
    const center = W / 2;
    const maxW = road ? RR.Road.maxWidth(road) : C.ROAD.width;
    const leftEdge  = road ? center - maxW / 2 : C.ROAD.x;
    const rightEdge = road ? center + maxW / 2 : C.ROAD.x + C.ROAD.width;
    const margin = 4;
    const left = Math.random() < 0.5;
    let x;
    if (left) {
      const min = margin;
      const max = leftEdge - margin - sprite.width;
      if (max <= min) return;
      x = min + Math.random() * (max - min);
    } else {
      const min = rightEdge + margin;
      const max = W - margin - sprite.width;
      if (max <= min) return;
      x = min + Math.random() * (max - min);
    }
    map.decos.push({
      sprite,
      x: Math.round(x),
      y: -sprite.height,
    });
  }

  function update(map, dt, car, road) {
    const speed = car.speed;
    for (const d of map.decos) d.y += speed * dt;
    map.decos = map.decos.filter(d => d.y < C.INTERNAL_HEIGHT + 40);

    map.spawnCooldown -= dt;
    if (map.spawnCooldown <= 0) {
      spawnDeco(map, road);
      const [lo, hi] = map.cfg.spawnInterval;
      map.spawnCooldown = lo + Math.random() * (hi - lo);
    }
  }

  function draw(ctx, map, worldOffset, road) {
    const W = C.INTERNAL_WIDTH;
    const H = C.INTERNAL_HEIGHT;

    // Fill full canvas with ground; the road draws asphalt over it per-row.
    ctx.fillStyle = map.cfg.groundColor;
    ctx.fillRect(0, 0, W, H);

    // Scrolling accent dots — keep the eye on motion even on a still road.
    if (map.cfg.accentColor) {
      ctx.fillStyle = map.cfg.accentColor;
      const period = map.cfg.accentPeriod || 32;
      const off = ((worldOffset * 0.6) % period + period) % period;
      for (let y = -period + (off | 0); y < H; y += period) {
        ctx.fillRect(8, y, 5, 5);
        ctx.fillRect(22, y + (period >> 1), 3, 3);
        ctx.fillRect(W - 14, y + 6, 5, 5);
        ctx.fillRect(W - 28, y + (period >> 1) + 4, 3, 3);
      }
    }

    for (const d of map.decos) {
      ctx.drawImage(d.sprite, d.x, Math.round(d.y));
    }
  }

  return { create, update, draw };
})();
