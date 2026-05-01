// Style points: a parallel scoring system independent of career pay.
// Counts flashy / risky play — passes, RR rams, near misses, narrow merges,
// hazard hops, jumps, off-road time. Shows as small floaters near the car
// plus a running total in the HUD. Persists lifetime total into the save.
//
// State:
//   { total, lifetime, passStreak, rageStreak, jumpsThisShift, offRoadAccum,
//     nearMissCooldown, narrowMergeCooldown, floaters: [...] }
//
// Detection signals come from the rest of the game (rage.justPassedCount,
// powerups.justActivated, hazards array, etc). main.js calls the per-event
// helpers; this module owns the streak math and the floaters.
window.RR = window.RR || {};

RR.Style = (function () {
  const C = RR.Config;

  function create(lifetime) {
    return {
      total: 0,
      lifetime: lifetime || 0,
      passStreak: 0,
      rageStreak: 0,
      jumpsThisShift: 0,
      offRoadAccum: 0,
      nearMissCooldown: 0,
      narrowMergeCooldown: 0,
      floaters: [],
    };
  }

  // Fresh per-shift state, but keep the lifetime total intact.
  function resetShift(s) {
    s.total = 0;
    s.passStreak = 0;
    s.rageStreak = 0;
    s.jumpsThisShift = 0;
    s.offRoadAccum = 0;
    s.nearMissCooldown = 0;
    s.narrowMergeCooldown = 0;
    s.floaters.length = 0;
  }

  // Index into a fibonacci-style streak table, capped at the last entry.
  function fibAt(table, idx) {
    if (idx < 0) idx = 0;
    if (idx >= table.length) idx = table.length - 1;
    return table[idx];
  }

  // Award + spawn a floater at (x,y). Color hints at the source family.
  // To avoid stacks of overlapping floaters when several events fire in
  // quick succession, find any active floaters in the same x band and
  // park this new one just below the lowest of them. Each floater still
  // rises on its own age, so the column drifts upward as a whole and the
  // bottom slot becomes free again as soon as the chain quiets down.
  function award(s, points, label, x, y, color) {
    if (!points) return;
    s.total += points;
    s.lifetime += points;
    const spacing = C.STYLE.floaterSpacing || 10;
    let placedY = y;
    for (const f of s.floaters) {
      if (Math.abs(f.x - x) > 32) continue;
      if (f.y + spacing > placedY) placedY = f.y + spacing;
    }
    s.floaters.push({
      text: '+' + points + (label ? ' ' + label : ''),
      x, y: placedY,
      spawnY: placedY,
      age: 0,
      life: C.STYLE.floaterLife,
      color: color || '#ffe060',
    });
    // Cap floater queue so a chain of events doesn't balloon memory.
    if (s.floaters.length > 12) s.floaters.shift();
  }

  // ---------------- Event hooks ----------------

  function onPass(s, count, car) {
    const cfg = C.STYLE;
    for (let i = 0; i < count; i++) {
      const pts = fibAt(cfg.streakFib, s.passStreak);
      award(s, pts, 'PASS', car.x, car.y - 6, '#9eea9e');
      s.passStreak++;
    }
  }

  // Player got passed by an NPC — break the pass streak.
  function onPassedBy(s) {
    s.passStreak = 0;
  }

  function onRageHit(s, car) {
    const cfg = C.STYLE;
    const pts = fibAt(cfg.rageStreakFib, s.rageStreak);
    const labels = ['SMACK', 'BOOM', 'CRUNCH', 'PILEUP', 'CARNAGE', 'ANNIHILATE'];
    const label = labels[Math.min(s.rageStreak, labels.length - 1)];
    award(s, pts, label, car.x, car.y - 6, '#ff8060');
    s.rageStreak++;
  }

  function onRageExit(s) {
    s.rageStreak = 0;
  }

  // Crashing also breaks both streaks.
  function onCrash(s) {
    s.passStreak = 0;
    s.rageStreak = 0;
  }

  function onPowerup(s, type, car) {
    const upper = type ? type.toUpperCase() : 'POWER';
    award(s, C.STYLE.powerup, upper, car.x, car.y - 6, '#a0d8ff');
  }

  function onNearMiss(s, car) {
    if (s.nearMissCooldown > 0) return;
    s.nearMissCooldown = C.STYLE.nearMissCooldown;
    award(s, C.STYLE.nearMiss, 'NEAR MISS', car.x, car.y - 6, '#ffe060');
  }

  function onNarrowMerge(s, car) {
    if (s.narrowMergeCooldown > 0) return;
    s.narrowMergeCooldown = C.STYLE.narrowMergeCooldown;
    award(s, C.STYLE.narrowMerge, 'THREADED!', car.x, car.y - 6, '#ffd040');
  }

  function onFastDodge(s, car) {
    award(s, C.STYLE.fastDodge, 'DODGE!', car.x, car.y - 6, '#a0d8ff');
  }

  function onHazardHop(s, car) {
    award(s, C.STYLE.hazardHop, 'HOP!', car.x, car.y - 6, '#a0d8ff');
  }

  function onClearance(s, car) {
    award(s, C.STYLE.clearance, 'CLEARANCE', car.x, car.y - 6, '#ffe060');
  }

  function onJump(s, car) {
    s.jumpsThisShift++;
    const cfg = C.STYLE;
    const pts = cfg.airtimeBase + cfg.airtimeIncrement * (s.jumpsThisShift - 1);
    award(s, pts, 'AIRTIME', car.x, car.y - 6, '#ffd040');
  }

  // Off-road time accumulates per second; only awards every full second so
  // we get one floater per "tick" rather than a stream of fractional ones.
  // Speed-scaled so creeping at the edge doesn't farm points.
  function onOffRoadTick(s, dt, car) {
    const cfg = C.STYLE;
    const speedFrac = car.speed / C.CAR.maxSpeed;
    if (speedFrac < cfg.offRoadMinSpeedFrac) return;
    s.offRoadAccum += dt;
    while (s.offRoadAccum >= 1) {
      s.offRoadAccum -= 1;
      const pts = Math.round(cfg.offRoadPerSec * speedFrac);
      award(s, pts, 'SHOULDER', car.x, car.y - 6, '#ffaa40');
    }
  }

  function onShiftComplete(s, levelIdx, late, raging, car) {
    const cfg = C.STYLE;
    let pts = cfg.shiftComplete * (levelIdx + 1);
    if (!late) pts += cfg.shiftCompleteOnTime;
    if (!raging) pts += cfg.shiftCompleteNoRage;
    award(s, pts, 'SHIFT', car ? car.x : 128, car ? car.y - 6 : 120, '#9eea9e');
    return pts;
  }

  // ---------------- Per-frame tick ----------------

  function update(s, dt) {
    if (s.nearMissCooldown > 0)
      s.nearMissCooldown = Math.max(0, s.nearMissCooldown - dt);
    if (s.narrowMergeCooldown > 0)
      s.narrowMergeCooldown = Math.max(0, s.narrowMergeCooldown - dt);

    for (const f of s.floaters) {
      f.age += dt;
      f.y -= (C.STYLE.floaterRise / C.STYLE.floaterLife) * dt;
    }
    s.floaters = s.floaters.filter(f => f.age < f.life);
  }

  // ---------------- Render ----------------

  function drawFloaters(ctx, s) {
    if (!s.floaters.length) return;
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of s.floaters) {
      const t = f.age / f.life;
      // Quick fade-in (first 15%), hold, then fade-out tail.
      let alpha;
      if (t < 0.15)      alpha = t / 0.15;
      else if (t < 0.7)  alpha = 1;
      else               alpha = 1 - (t - 0.7) / 0.3;
      if (alpha <= 0) continue;
      // Drop shadow for legibility against the road.
      ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.6 * alpha).toFixed(3) + ')';
      ctx.fillText(f.text, Math.round(f.x) + 1, Math.round(f.y) + 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  // Bottom-center counter. Compact format (12.5K, 1.2M) when long.
  function drawCounter(ctx, s) {
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const txt = 'STYLE  ' + formatNum(s.total);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(txt, W / 2 + 1, H - 11);
    ctx.fillStyle = '#ffe060';
    ctx.fillText(txt, W / 2, H - 12);
    ctx.textAlign = 'left';
  }

  function formatNum(n) {
    if (n < 1000) return String(n);
    if (n < 1e6)  return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'K';
    return (n / 1e6).toFixed(1) + 'M';
  }

  return {
    create, resetShift,
    onPass, onPassedBy, onRageHit, onRageExit, onCrash,
    onPowerup, onNearMiss, onNarrowMerge, onFastDodge,
    onHazardHop, onClearance, onJump, onOffRoadTick,
    onShiftComplete,
    update, drawFloaters, drawCounter, formatNum,
  };
})();
