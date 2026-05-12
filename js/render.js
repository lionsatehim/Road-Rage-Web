// Drawing primitives. The render module knows nothing about input or game logic;
// it just paints state to the internal-resolution canvas.
window.RR = window.RR || {};

RR.Render = (function () {
  const C = RR.Config;

  function clear(ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, C.INTERNAL_WIDTH, C.INTERNAL_HEIGHT);
  }

  function drawRoad(ctx, worldOffset) {
    const r = C.ROAD;
    const H = C.INTERNAL_HEIGHT;

    // Off-road ground + accents are rendered by RR.Map (drawn first, before
    // this function). drawRoad only owns the asphalt, edges, and stripes.

    // Road surface
    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(r.x, 0, r.width, H);

    // Edge lines (solid white)
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(r.x, 0, 2, H);
    ctx.fillRect(r.x + r.width - 2, 0, 2, H);

    // Lane stripes (dashed yellow), scrolling with worldOffset
    ctx.fillStyle = '#e8c020';
    const laneW = r.width / r.lanes;
    const dash = r.stripeH + r.stripeGap;
    const stripeOff = ((worldOffset % dash) + dash) % dash;
    for (let l = 1; l < r.lanes; l++) {
      const sx = (r.x + laneW * l - 1) | 0;
      for (let y = -dash + (stripeOff | 0); y < H; y += dash) {
        ctx.fillRect(sx, y, 2, r.stripeH);
      }
    }
  }

  function drawCar(ctx, car, raging, jumpH, invincT, damageFrame) {
    const lift = jumpH || 0;
    const x = Math.round(car.x - C.CAR.width / 2);
    const y = Math.round(car.y - C.CAR.height / 2 - lift);
    // Brief flash while stunned so the reset period reads. Same effect for
    // post-jump landing grace so the invincibility window is visible.
    if (car.stunnedTimer > 0 && Math.floor(car.stunnedTimer * 10) % 2 === 0) {
      ctx.globalAlpha = 0.55;
    } else if (invincT > 0 && Math.floor(invincT * 18) % 2 === 0) {
      ctx.globalAlpha = 0.55;
    }
    // Shadow under the car when airborne.
    if (lift > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const sx = Math.round(car.x - C.CAR.width / 2 + 2);
      const sy = Math.round(car.y - C.CAR.height / 2 + C.CAR.height - 2);
      ctx.fillRect(sx, sy, C.CAR.width - 4, 3);
    }
    // RR mode: alternate between red and yellow tints (~12 Hz) for a
    // Mario-star "invincible" feel. Outside RR: plain player sprite.
    // First try the file-loaded sheet (with baked rage variants); fall
    // back to the procedural PLAYER / PLAYER_RAGING / _YELLOW constants.
    const ragingMode = raging
      ? (Math.floor(performance.now() / 80) % 2 === 0 ? 'red' : 'yellow')
      : null;
    let sprite = RR.Sprites.getPlayerSprite(0, damageFrame || 0, ragingMode);
    if (!sprite) {
      if (raging) {
        sprite = ragingMode === 'red' ? RR.Sprites.PLAYER_RAGING : RR.Sprites.PLAYER_RAGING_YELLOW;
      } else {
        sprite = RR.Sprites.PLAYER;
      }
    }
    RR.Sprites.draw(ctx, sprite, x, y);
    drawBrakeLights(ctx, x, y, car.braking);
    ctx.globalAlpha = 1;
  }

  // Two small rectangles on the rear bumper of any 16x24 car sprite. Dim
  // by default, bright red while braking — same positions for player + NPCs.
  function drawBrakeLights(ctx, x, y, on) {
    ctx.fillStyle = on ? '#ff3030' : '#601010';
    ctx.fillRect(x + 5, y + 21, 2, 2);
    ctx.fillRect(x + 9, y + 21, 2, 2);
  }

  // Yellow blinker pixel at one rear corner — used by NPC draw. side: -1 left, +1 right.
  function drawBlinker(ctx, x, y, side) {
    ctx.fillStyle = '#ffd040';
    if (side < 0) ctx.fillRect(x + 3, y + 20, 2, 2);
    else          ctx.fillRect(x + 11, y + 20, 2, 2);
  }

  function drawRageMeter(ctx, rage, t) {
    const total = 10, segW = 8, segH = 8, gap = 1;
    const barW = total * (segW + gap) - gap;
    const x0 = (C.INTERNAL_WIDTH - barW) >> 1;
    const y0 = 6;

    // Backplate / border
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x0 - 2, y0 - 2, barW + 4, segH + 4);
    ctx.fillStyle = '#222';
    ctx.fillRect(x0 - 1, y0 - 1, barW + 2, segH + 2);

    const filled = Math.floor(rage.level / 10 + 0.001);
    for (let i = 0; i < total; i++) {
      const sx = x0 + i * (segW + gap);
      let color = '#0a0a0a';
      if (i < filled) {
        if (i < 4)      color = '#3cd040';
        else if (i < 7) color = '#e8c020';
        else if (i < 9) color = '#e88820';
        else            color = '#e84040';
      }
      ctx.fillStyle = color;
      ctx.fillRect(sx, y0, segW, segH);
    }

    // Permanent "RAGE" label below the meter. Pulses red/orange and
    // gains an exclamation mark while Road Rage is active.
    const inRR = rage.roadRageTimer > 0;
    const pulse = inRR ? (Math.sin(t * 14) + 1) * 0.5 : 0;
    if (inRR) {
      ctx.strokeStyle = pulse > 0.5 ? '#ff6060' : '#ffaa00';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 3, y0 - 3, barW + 6, segH + 6);
    }
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = inRR
      ? (pulse > 0.5 ? '#ff6060' : '#ffaa00')
      : '#888';
    ctx.fillText(inRR ? 'RAGE!' : 'RAGE METER', C.INTERNAL_WIDTH / 2, y0 + segH + 2);
    ctx.textAlign = 'left';
  }

  // Shortcut effect: dramatic flash with attack/hold/release envelope.
  // Total 1.0s. Gameplay (NPC clear, worldOffset jump) already fired on
  // activation — this is purely visual. shockTimer counts 1.0 → 0.
  //   attack  (1.00 → 0.92): alpha 0 → 1
  //   hold    (0.92 → 0.80): alpha 1, bolts cracking
  //   release (0.80 → 0.00): alpha exponential 1 → 0; bolts fade in first 150ms
  function drawShortcutFlash(ctx, shockTimer) {
    if (shockTimer <= 0) return;
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    const TOTAL = 1.0;
    const ATTACK_END   = 0.92;   // shockTimer values (counting down)
    const HOLD_END     = 0.80;
    const t = Math.max(0, Math.min(TOTAL, shockTimer));

    // ---- Flash alpha envelope ----
    let alpha;
    if (t > ATTACK_END) {
      const a = (TOTAL - t) / (TOTAL - ATTACK_END);   // 0→1
      alpha = a;
    } else if (t > HOLD_END) {
      alpha = 1;
    } else {
      const r = t / HOLD_END;                          // 1→0
      alpha = Math.pow(r, 1.6);                        // ease-out
    }

    // ---- Bolts: visible during attack + hold + first ~150ms of release ----
    const boltsActive = t > (HOLD_END - 0.15);
    if (boltsActive) {
      // Bolt opacity dips through release tail so they dissolve smoothly.
      let bAlpha = 1;
      if (t < HOLD_END) bAlpha = (t - (HOLD_END - 0.15)) / 0.15;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.95 * bAlpha).toFixed(3) + ')';
      ctx.lineWidth = 2;
      // Refresh bolt geometry a few times per second — too fast = strobing.
      const seed = Math.floor(t * 14);
      const rng = (n) => {
        const s = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
        return s - Math.floor(s);
      };
      for (let b = 0; b < 3; b++) {
        const startX = 30 + rng(b * 7 + 1) * (W - 60);
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        let x = startX;
        for (let y = 8; y < H; y += 10) {
          x += (rng(b * 13 + y) - 0.5) * 18;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // ---- Full-screen flash ----
    ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 0.88).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }

  // Coffee vignette: warm amber, with an activation "punch" so the slow-down
  // telegraphs visibly before traffic starts dragging. Drawn under the rage
  // vignette so red overlays cleanly when both are active.
  function drawCoffeeVignette(ctx, powerups, t) {
    const env   = RR.Powerups.coffeeEnvelope(powerups);
    const punch = RR.Powerups.coffeePunch(powerups);
    if (env <= 0 && punch <= 0) return;
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;

    const pulse = (Math.sin(t * 4) + 1) * 0.5;
    const innerA = env * (0.10 + 0.06 * pulse) + punch * 0.20;
    const outerA = env * (0.32 + 0.06 * pulse) + punch * 0.45;
    const grad = ctx.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, 200);
    grad.addColorStop(0, 'rgba(230, 160, 60, 0)');
    grad.addColorStop(0.65, 'rgba(230, 160, 60, ' + innerA.toFixed(3) + ')');
    grad.addColorStop(1,    'rgba(200, 130, 40, ' + outerA.toFixed(3) + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Translucent amber strip over the grass area that becomes drivable while
  // coffee is active. Tied to the smoothed shoulderSlack so it visibly recedes
  // as the lane re-clamps the car back into bounds after coffee ends.
  function drawShoulderStrips(ctx, powerups, road) {
    const slack = RR.Powerups.shoulderSlack(powerups);
    if (slack < 0.5) return;
    const cfgExtra = RR.Config.POWERUPS.types.coffee.shoulderExtra || 1;
    const intensity = Math.min(1, slack / cfgExtra);
    const left  = road ? road.leftEdge  : C.ROAD.x;
    const right = road ? road.rightEdge : C.ROAD.x + C.ROAD.width;
    const H = C.INTERNAL_HEIGHT;
    const a = (0.18 * intensity).toFixed(3);
    ctx.fillStyle = 'rgba(230, 160, 60, ' + a + ')';
    ctx.fillRect(left - slack, 0, slack, H);
    ctx.fillRect(right, 0, slack, H);

    // Dashed amber line at the live outer boundary — moves inward smoothly as
    // slack decays so the player sees the drivable zone retracting.
    ctx.fillStyle = 'rgba(255, 200, 90, ' + (0.55 * intensity).toFixed(3) + ')';
    const dashH = 6, gap = 4;
    for (let y = 0; y < H; y += dashH + gap) {
      ctx.fillRect(Math.round(left - slack), y, 1, dashH);
      ctx.fillRect(Math.round(right + slack - 1), y, 1, dashH);
    }
  }

  // Tire marks: dark smudges that fade as they age. Drawn after the road but
  // before pickups/cars so they sit on the surface.
  function drawTireMarks(ctx, marks) {
    if (!marks || marks.length === 0) return;
    for (const m of marks) {
      const a = Math.max(0, 1 - m.age / m.life);
      ctx.fillStyle = 'rgba(20, 14, 10, ' + (0.5 * a).toFixed(3) + ')';
      ctx.fillRect(Math.round(m.x), Math.round(m.y), 2, 2);
    }
  }

  function drawRoadRageVignette(ctx, rage, t) {
    if (rage.roadRageTimer <= 0) return;
    const pulse = (Math.sin(t * 8) + 1) * 0.5;
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    const grad = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 180);
    grad.addColorStop(0, 'rgba(220, 30, 30, 0)');
    grad.addColorStop(0.65, 'rgba(220, 30, 30, ' + (0.18 + 0.10 * pulse).toFixed(3) + ')');
    grad.addColorStop(1,    'rgba(180, 20, 20, ' + (0.55 + 0.10 * pulse).toFixed(3) + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawHUD(ctx, s, t) {
    ctx.fillStyle = '#fff';
    ctx.font = '8px "Courier New", monospace';
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    // Career line replaces the placeholder title once a track is picked.
    if (s.career && s.career.track) {
      const lvl = RR.Career.levelCfg(s.career);
      ctx.fillText(lvl.title.toUpperCase(), 4, 4);
      ctx.fillStyle = '#ffe060';
      ctx.fillText(s.career.city || '', 4, 14);
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillText('RUSH HOUR', 4, 4);
    }
    // Top-right: lifetime style points, full digits (no K/M truncation).
    // This persists across shifts so the user sees their career total,
    // not the per-shift tally (which legitimately resets at each start).
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe060';
    ctx.fillText('STYLE ' + (s.style.lifetime || 0), C.INTERNAL_WIDTH - 4, 4);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';

    drawRageMeter(ctx, s.rage, t);
    drawPowerupSlot(ctx, s.powerups, t);
    if (s.career && s.career.track) drawCareerHUD(ctx, s);
  }

  // Drive-HUD additions: deadline countdown, distance bar, lifetime earnings,
  // and the promo/demote streak ribbons. Bottom-right corner so it doesn't
  // collide with the powerup slot on the bottom-left.
  function drawCareerHUD(ctx, s) {
    const cc = RR.Config.CAREERS;
    const car = s.career;
    const sh = car.shift;
    if (!sh) return;

    const W = C.INTERNAL_WIDTH;
    const H = C.INTERNAL_HEIGHT;

    // Distance progress bar — below the rage meter so they don't overlap.
    const distFrac = Math.min(1, sh.distance / cc.shiftDistance);
    const barX = 4, barY = 26, barW = W - 8, barH = 2;
    ctx.fillStyle = '#222';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#60c8ff';
    ctx.fillRect(barX, barY, Math.round(barW * distFrac), barH);

    // Deadline countdown — top-right under MPH.
    const remain = Math.max(0, sh.deadline - sh.elapsed);
    const late = sh.elapsed > sh.deadline;
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = late ? '#ff6060' : (remain < 5 ? '#ffaa00' : '#aef');
    ctx.textAlign = 'right';
    const mins = Math.floor(remain / 60);
    const secs = Math.floor(remain % 60);
    const time = late
      ? '-' + Math.floor(sh.elapsed - sh.deadline) + 's'
      : mins + ':' + secs.toString().padStart(2, '0');
    ctx.fillText(time, W - 4, 16);

    // Bottom-right stack of vertical gauges, from top to bottom:
    //   [trophy, when retiring]
    //   PRO or RET bar  + label
    //   DMG bar         + label
    //   $earnings
    // Hugs the right edge to leave the right shoulder clear for scenery.
    const tcfg = RR.Career.trackCfg(car);
    const atTop = car.levelIdx === tcfg.levels.length - 1;
    const gW = 6;
    const gH = 30;
    const gX = W - 10;

    // --- DMG (always shown) ---
    const dmgFrac = Math.min(1, car.damage / 200);  // soft cap ~6 hard crashes
    const dmgColor = dmgFrac > 0.66 ? '#ff6060'
                   : dmgFrac > 0.33 ? '#ffaa40'
                   : '#7fe07f';
    const dmgBarY = H - 51;
    drawVerticalBar(ctx, gX, dmgBarY, gW, gH, dmgFrac, dmgColor);
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = dmgColor;
    ctx.textAlign = 'right';
    ctx.fillText('DMG', gX + gW, H - 18);

    // --- PRO (streak progress) or RET (retirement progress, top rung only) ---
    const proBarY = dmgBarY - gH - 10;
    if (atTop) {
      const retFrac = Math.min(1, car.lifetimeEarnings / cc.retirementTarget);
      drawVerticalBar(ctx, gX, proBarY, gW, gH, retFrac, '#ffe060');
      ctx.fillStyle = '#ffe060';
      ctx.fillText('RET', gX + gW, proBarY + gH + 2);
      drawTrophyIcon(ctx, gX + gW - 6, proBarY - 8);
    } else {
      const need = tcfg.promoteStreak || 3;
      const proFrac = Math.min(1, car.promoStreak / need);
      drawVerticalBar(ctx, gX, proBarY, gW, gH, proFrac, '#7fe07f', need);
      ctx.fillStyle = '#7fe07f';
      ctx.fillText('PRO', gX + gW, proBarY + gH + 2);
    }

    // --- Lifetime earnings, very bottom-right. ---
    ctx.fillStyle = '#9eea9e';
    ctx.textAlign = 'right';
    ctx.fillText('$' + car.lifetimeEarnings, gX + gW, H - 8);
    ctx.textAlign = 'left';
  }

  // Vertical fill bar. fillFrac in [0,1] fills from the bottom upward.
  // If `segments` is given, snaps fill to whole-segment increments and
  // draws thin dividers between segments. Otherwise renders continuous.
  function drawVerticalBar(ctx, x, y, w, h, fillFrac, color, segments) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#222';
    ctx.fillRect(x, y, w, h);
    let frac = Math.max(0, Math.min(1, fillFrac));
    if (segments && segments > 0) {
      frac = Math.floor(frac * segments + 0.0001) / segments;
    }
    const fillH = Math.round(h * frac);
    if (fillH > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y + h - fillH, w, fillH);
    }
    if (segments && segments > 1) {
      ctx.fillStyle = '#0a0a0a';
      for (let i = 1; i < segments; i++) {
        const sy = y + Math.round(h * i / segments);
        ctx.fillRect(x, sy, w, 1);
      }
    }
  }

  // Small trophy icon — drawn above the RET bar when the player is on
  // the final rung, signaling "this is the prize you're climbing toward".
  function drawTrophyIcon(ctx, x, y) {
    ctx.fillStyle = '#ffe060';
    // Cup top (6 wide)
    ctx.fillRect(x, y, 6, 1);
    // Bowl
    ctx.fillRect(x + 1, y + 1, 4, 1);
    ctx.fillRect(x + 1, y + 2, 4, 1);
    // Stem
    ctx.fillRect(x + 2, y + 3, 2, 1);
    // Base
    ctx.fillRect(x + 1, y + 4, 4, 1);
  }

  function drawPowerupSlot(ctx, p, t) {
    if (!p) return;
    const w = 18, h = 18;
    const activeX = 4;
    const queuedX = activeX + w + 3;
    const y = C.INTERNAL_HEIGHT - 22;

    // ---- Active slot (left) ----
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(activeX, y, w, h);
    ctx.strokeStyle = p.active ? '#ffaa00' : '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(activeX + 0.5, y + 0.5, w - 1, h - 1);
    if (p.active) {
      const sprite = RR.Sprites.PICKUPS[p.active.type];
      if (sprite) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(sprite, activeX + 2, y + 2);
        ctx.globalAlpha = 1;
      }
      const cfg = p.active.cfg;
      if (cfg.duration > 0) {
        const frac = Math.max(0, p.active.timer / cfg.duration);
        ctx.fillStyle = '#ffaa00';
        ctx.fillRect(activeX, y - 3, Math.round(w * frac), 2);
      }
    }

    // ---- Queued slot (right) — held pickup, ready to activate. ----
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(queuedX, y, w, h);
    // Border: bright when usable now (no active running), dim while waiting.
    const usable = RR.Powerups.canActivate(p);
    ctx.strokeStyle = usable ? '#ffe060' : '#333';
    ctx.strokeRect(queuedX + 0.5, y + 0.5, w - 1, h - 1);
    if (p.inventory) {
      const sprite = RR.Sprites.PICKUPS[p.inventory];
      if (sprite) {
        // Dim the icon while another effect is still running.
        ctx.globalAlpha = usable ? 1 : 0.5;
        ctx.drawImage(sprite, queuedX + 2, y + 2);
        ctx.globalAlpha = 1;
      }
      if (usable) {
        const pulse = (Math.sin(t * 6) + 1) * 0.5;
        ctx.fillStyle = pulse > 0.5 ? '#ffe060' : '#a08020';
        ctx.fillText('SPACE', queuedX + w + 3, y + 5);
      }
    }
  }

  // Power-up activation banner. Total envelope = 1.23s; fades + slides at the
  // ends so it pops in, holds, then drifts up and out.
  //   in   (0.00 → 0.18): alpha 0→1, slide y 6→0 (drops into place)
  //   hold (0.18 → 0.88): full opacity
  //   out  (0.88 → 1.23): alpha 1→0, slide y 0→-10
  function drawBanner(ctx, banner) {
    if (!banner || banner.timer <= 0) return;
    const TOTAL = 1.23;
    const elapsed = TOTAL - banner.timer;
    let alpha, yOffset;
    if (elapsed < 0.18) {
      const f = elapsed / 0.18;
      alpha = f;
      yOffset = 6 * (1 - f);
    } else if (elapsed < 0.88) {
      alpha = 1;
      yOffset = 0;
    } else {
      const f = Math.min(1, (elapsed - 0.88) / 0.35);
      alpha = 1 - f;
      yOffset = -10 * f;
    }
    if (alpha <= 0) return;

    const cx = C.INTERNAL_WIDTH / 2;
    const cy = 64 + Math.round(yOffset);

    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Drop shadow for legibility against varied road/grass.
    ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.65 * alpha).toFixed(3) + ')';
    ctx.fillText(banner.text, cx + 1, cy + 1);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = banner.color;
    ctx.fillText(banner.text, cx, cy);
    ctx.globalAlpha = 1;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }


  // Career select screen. Shown only at game start (or after retiring / game
  // over). Three tracks, picked with 1/2/3.
  function drawCareerSelect(ctx, t, career) {
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, W, H);

    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe060';
    ctx.fillText('RUSH HOUR RAGE', W / 2, 18);

    const hasSave = career && career.track;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);

    // Continue strip — shown only when there's a saved career.
    let listStartY = 36;
    if (hasSave) {
      const lvl = RR.Career.levelCfg(career);
      const tcfg = RR.Career.trackCfg(career);
      const y = 30;
      ctx.fillStyle = '#1c2a36';
      ctx.fillRect(20, y, W - 40, 22);
      ctx.strokeStyle = '#7fe07f';
      ctx.lineWidth = 1;
      ctx.strokeRect(20.5, y + 0.5, W - 41, 21);
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7fe07f';
      ctx.fillText('C.', 28, y + 6);
      ctx.fillStyle = '#fff';
      ctx.fillText('Continue', 44, y + 6);
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = '#9aa';
      const styleStr = career.lifetimeStyle
        ? '  ★ ' + RR.Style.formatNum(career.lifetimeStyle)
        : '';
      ctx.fillText(tcfg.name + ' — ' + lvl.title + ' ($' + career.lifetimeEarnings + ')' + styleStr,
                   44, y + 16);
      listStartY = 60;
    }

    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#aaa';
    ctx.fillText(hasSave ? 'OR PICK A NEW CAREER' : 'PICK YOUR CAREER',
                 W / 2, listStartY - 4);

    const tracks = [
      { key: '1', name: 'Skilled Trades', tag: 'Balanced',  color: '#9eea9e' },
      { key: '2', name: 'Finance',        tag: '$$$ / High stress', color: '#ffe060' },
      { key: '3', name: 'Teacher',        tag: 'Low pay / Low stress', color: '#a0d8ff' },
    ];

    const rowH = 36;
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      const y = listStartY + 6 + i * rowH;
      ctx.fillStyle = '#1c2a36';
      ctx.fillRect(20, y, W - 40, rowH - 6);
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(20.5, y + 0.5, W - 41, rowH - 7);

      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = tr.color;
      ctx.fillText(tr.key + '.', 28, y + 7);
      ctx.fillStyle = '#fff';
      ctx.fillText(tr.name, 44, y + 7);
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = '#9aa';
      ctx.fillText(tr.tag, 44, y + 20);
    }

    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = pulse > 0.5 ? '#fff' : '#888';
    ctx.fillText(hasSave ? 'C TO CONTINUE  •  1/2/3 NEW GAME' : 'PRESS 1, 2, OR 3',
                 W / 2, H - 10);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  // Post-shift summary modal: pay breakdown, streak update, promo/demo ribbon.
  function drawShiftEnd(ctx, career) {
    const r = career.lastResult;
    if (!r) return;
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;

    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, W, H);

    const boxX = 12, boxW = W - 24;
    const boxY = 16, boxH = H - 32;
    ctx.fillStyle = '#0e1620';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    ctx.textBaseline = 'top';

    // ---- Header ----
    let header = 'SHIFT COMPLETE';
    let headColor = '#9eea9e';
    if (r.raging)      { header = 'YOU ARRIVED IN A RAGE'; headColor = '#ff6060'; }
    else if (r.late)   { header = 'YOU WERE LATE';         headColor = '#ffaa40'; }
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = headColor;
    ctx.fillText(header, W / 2, boxY + 6);

    // ---- Promo / demo announcement (one line under header) ----
    ctx.font = 'bold 8px "Courier New", monospace';
    if (r.promoted) {
      ctx.fillStyle = '#ffe060';
      ctx.fillText('★ PROMOTED → ' + r.newLevelTitle + ' — ' + r.newCity + ' ★',
                   W / 2, boxY + 18);
    } else if (r.demoted) {
      ctx.fillStyle = '#ff8060';
      ctx.fillText('▼ DEMOTED → ' + r.newLevelTitle + ' — ' + r.newCity + ' ▼',
                   W / 2, boxY + 18);
    }

    // ---- Two columns ----
    const colTop = boxY + 30;
    const lcL = boxX + 6;                    // left col, label x
    const lcR = boxX + boxW / 2 - 4;         // left col, value right x
    const rcL = boxX + boxW / 2 + 4;         // right col, label x
    const rcR = boxX + boxW - 6;             // right col, value right x

    let yL = colTop;
    let yR = colTop;

    ctx.font = '8px "Courier New", monospace';

    // === LEFT COLUMN ===

    yL = sectionHeader(ctx, 'DRIVE', lcL, lcR, yL);
    yL = kvRow(ctx, 'Time',
               formatTime(r.elapsed) + ' / ' + formatTime(r.deadline),
               r.late ? '#ff8060' : '#9eea9e',
               lcL, lcR, yL);
    yL = kvRow(ctx, 'Stress', stressLabel(r), stressColor(r), lcL, lcR, yL);
    if (r.cheerDrop > 0) {
      yL = kvRow(ctx, 'Kids cheered',
                 '-' + Math.round(r.cheerDrop) + ' rage',
                 '#a0d8ff', lcL, lcR, yL);
    }
    yL += 3;

    yL = sectionHeader(ctx, 'EARNINGS', lcL, lcR, yL);
    yL = kvRow(ctx, 'Base pay', '$' + r.base, '#fff', lcL, lcR, yL);
    if (r.bonusPct > 0) {
      yL = kvRow(ctx, 'Bonus', '+' + pct(r.bonusPct), '#9eea9e', lcL, lcR, yL);
    }
    if (r.penaltyPct > 0) {
      yL = kvRow(ctx, 'Late penalty', '-' + pct(r.penaltyPct), '#ff8060', lcL, lcR, yL);
    }
    yL = subtotalDivider(ctx, lcL, lcR, yL);
    yL = kvRow(ctx, 'Subtotal', '$' + r.grossPay,
               r.grossPay > 0 ? '#fff' : '#888', lcL, lcR, yL);
    yL += 3;

    yL = sectionHeader(ctx, 'REPAIRS', lcL, lcR, yL);
    yL = kvRow(ctx, 'Damage',
               r.damageCost > 0 ? '-$' + r.damageCost : '$0',
               r.damageCost > 0 ? '#ff8060' : '#888',
               lcL, lcR, yL);
    yL = subtotalDivider(ctx, lcL, lcR, yL);
    yL = kvRow(ctx, 'NET PAY', '$' + r.netPay,
               r.netPay > 0 ? '#9eea9e' : '#888', lcL, lcR, yL);

    // === RIGHT COLUMN ===

    yR = sectionHeader(ctx, 'STYLE', rcL, rcR, yR);
    yR = kvRow(ctx, 'This shift',
               String(r.styleShift !== undefined ? r.styleShift : 0),
               '#ffe060', rcL, rcR, yR);
    yR = kvRow(ctx, 'Lifetime',
               String(career.lifetimeStyle || 0),
               '#ffd040', rcL, rcR, yR);
    yR += 3;

    yR = sectionHeader(ctx, 'CAREER', rcL, rcR, yR);
    yR = kvRow(ctx, 'Total earnings', '$' + career.lifetimeEarnings,
               '#ffe060', rcL, rcR, yR);
    yR += 3;

    // Gauges row. Always show all three so the player learns the system.
    // For the top rung, the Promo gauge is replaced by a Retire bar showing
    // progress toward the retirement earnings target.
    const tcfg = RR.Career.trackCfg(career);
    const atTop = career.levelIdx === tcfg.levels.length - 1;
    const barW = rcR - rcL - 32;
    const barH = 5;
    if (atTop) {
      const frac = Math.min(1, career.lifetimeEarnings / C.CAREERS.retirementTarget);
      yR = gaugeRow(ctx, 'Retire', '#ffe060', frac, 0, rcL, rcR, barW, barH, yR);
    } else {
      yR = gaugeRow(ctx, 'Promo', '#9eea9e',
                    r.displayPromo / r.promoteStreak, r.promoteStreak,
                    rcL, rcR, barW, barH, yR);
    }
    yR = gaugeRow(ctx, 'Late', '#ffaa40',
                  r.displayLate / r.demoteStreak, r.demoteStreak,
                  rcL, rcR, barW, barH, yR);
    yR = gaugeRow(ctx, 'Rage', '#ff6060',
                  r.displayRage / r.demoteStreak, r.demoteStreak,
                  rcL, rcR, barW, barH, yR);

    // ---- Continue prompt ----
    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#aaa';
    ctx.fillText('PRESS ENTER', W / 2, boxY + boxH - 10);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  // ---- Shift-end layout helpers ----

  function sectionHeader(ctx, text, lx, rx, y) {
    ctx.font = 'bold 7px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7aa9c8';
    ctx.fillText(text, lx, y);
    ctx.fillStyle = '#2a3a4a';
    ctx.fillRect(lx, y + 8, rx - lx, 1);
    ctx.font = '8px "Courier New", monospace';
    return y + 11;
  }

  function kvRow(ctx, label, value, color, lx, rx, y) {
    ctx.fillStyle = '#aaa';
    ctx.textAlign = 'left';
    ctx.fillText(label, lx, y);
    ctx.fillStyle = color || '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(value, rx, y);
    return y + 9;
  }

  function subtotalDivider(ctx, lx, rx, y) {
    ctx.fillStyle = '#444';
    ctx.fillRect(lx + (rx - lx) / 2, y, (rx - lx) / 2, 1);
    return y + 3;
  }

  // One gauge row: "label  [▓▓░]". `frac` in [0,1] for continuous (segments=0),
  // or maps to whole segments when `segments` > 0.
  function gaugeRow(ctx, label, color, frac, segments, lx, rx, barW, barH, y) {
    ctx.fillStyle = '#aaa';
    ctx.textAlign = 'left';
    ctx.fillText(label, lx, y);
    const barX = rx - barW;
    if (segments > 0) {
      drawSegmentedBar(ctx, barX, y + 1, barW, barH, Math.round(frac * segments), segments, color);
    } else {
      ctx.fillStyle = '#222';
      ctx.fillRect(barX, y + 1, barW, barH);
      ctx.fillStyle = color;
      ctx.fillRect(barX, y + 1, Math.round(barW * Math.max(0, Math.min(1, frac))), barH);
    }
    return y + 10;
  }

  function drawSegmentedBar(ctx, x, y, w, h, filled, total, color) {
    const gap = 1;
    const segW = Math.max(1, Math.floor((w - gap * (total - 1)) / total));
    for (let i = 0; i < total; i++) {
      const sx = x + i * (segW + gap);
      ctx.fillStyle = (i < filled) ? color : '#333';
      ctx.fillRect(sx, y, segW, h);
    }
  }

  function drawGameOver(ctx, career) {
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff6060';
    ctx.fillText('GAME OVER', W / 2, H / 2 - 30);
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('You were fired.', W / 2, H / 2 - 10);
    ctx.fillStyle = '#ffe060';
    ctx.fillText('Lifetime earnings: $' + career.lifetimeEarnings, W / 2, H / 2 + 6);
    ctx.fillStyle = '#ffd040';
    ctx.fillText('Lifetime style: ' + RR.Style.formatNum(career.lifetimeStyle || 0),
                 W / 2, H / 2 + 16);
    ctx.fillStyle = '#aaa';
    ctx.fillText('Press R or Enter to start over', W / 2, H / 2 + 32);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  // ---- Retirement: page 1 (career stats) ----
  function drawRetiredStats(ctx, career) {
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = 'top';

    // Headline
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe060';
    ctx.fillText('YOU RETIRED!', W / 2, 12);

    // Career flavor line — which path and the final job title.
    const tcfg = career.track ? RR.Career.trackCfg(career) : null;
    const lcfg = career.track ? RR.Career.levelCfg(career) : null;
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = '#9eea9e';
    if (tcfg && lcfg) {
      ctx.fillText(tcfg.name.toUpperCase() + ' — Final title: ' + lcfg.title.toUpperCase(),
                   W / 2, 30);
    }

    // Two columns of stats inside a faint card.
    const boxX = 16, boxW = W - 32;
    const boxY = 46, boxH = H - 76;
    ctx.fillStyle = '#0e1620';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    const lcL = boxX + 6;
    const lcR = boxX + boxW / 2 - 4;
    const rcL = boxX + boxW / 2 + 4;
    const rcR = boxX + boxW - 6;

    let yL = boxY + 6;
    let yR = boxY + 6;

    // --- Left column: financial + work record ---
    yL = sectionHeader(ctx, 'CAREER', lcL, lcR, yL);
    yL = kvRow(ctx, 'Total earnings', '$' + (career.lifetimeEarnings || 0),
               '#ffe060', lcL, lcR, yL);
    yL = kvRow(ctx, 'Shifts worked', String(career.shiftsWorked || 0),
               '#fff', lcL, lcR, yL);
    const bst = career.bestShiftTime;
    yL = kvRow(ctx, 'Best shift',
               bst != null ? formatTime(bst) : '--',
               '#9eea9e', lcL, lcR, yL);
    yL = kvRow(ctx, 'Style points', String(career.lifetimeStyle || 0),
               '#ffd040', lcL, lcR, yL);
    yL += 4;

    yL = sectionHeader(ctx, 'CRASHES', lcL, lcR, yL);
    yL = kvRow(ctx, 'Hard crashes', String(career.crashCount || 0),
               (career.crashCount || 0) > 0 ? '#ff6060' : '#888', lcL, lcR, yL);
    yL = kvRow(ctx, 'Taps', String(career.tapCount || 0),
               (career.tapCount || 0) > 0 ? '#ffaa40' : '#888', lcL, lcR, yL);
    yL = kvRow(ctx, 'Rams (RR)', String(career.ramCount || 0),
               (career.ramCount || 0) > 0 ? '#ff8060' : '#888', lcL, lcR, yL);
    yL = kvRow(ctx, 'Repair $', '$' + (career.lifetimeRepairCost || 0),
               '#ff8060', lcL, lcR, yL);

    // --- Right column: powerup usage ---
    yR = sectionHeader(ctx, 'POWERUPS USED', rcL, rcR, yR);
    const pu = career.powerupsUsed || {};
    const order = ['coffee', 'jump', 'shortcut', 'lofi', 'wrench'];
    const labels = {
      coffee:   'Coffees',
      jump:     'Jumps',
      shortcut: 'Lightning',
      lofi:     'Lo-fi loops',
      wrench:   'Wrenches',
    };
    const colors = {
      coffee:   '#c4956a',
      jump:     '#7adfff',
      shortcut: '#ffe060',
      lofi:     '#c890ff',
      wrench:   '#ffa860',
    };
    for (const k of order) {
      yR = kvRow(ctx, labels[k], String(pu[k] || 0),
                 (pu[k] || 0) > 0 ? colors[k] : '#888',
                 rcL, rcR, yR);
    }

    // --- Full-width FAVORITE headliner at the bottom of the card ---
    // Find the most-used powerup; ties go to whichever appears first in
    // `order`. Render it across the full box width so the tagline + sub
    // have room to breathe without clipping the right column.
    let favKey = null, favN = 0;
    for (const k of order) if ((pu[k] || 0) > favN) { favN = pu[k]; favKey = k; }
    const favCx = boxX + boxW / 2;
    const favY  = boxY + boxH - 38;
    // Divider line + centered label
    ctx.fillStyle = '#2a3a4a';
    ctx.fillRect(boxX + 8, favY, boxW - 16, 1);
    ctx.font = 'bold 7px "Courier New", monospace';
    ctx.fillStyle = '#0e1620';
    ctx.fillRect(favCx - 26, favY - 4, 52, 8);
    ctx.fillStyle = '#7aa9c8';
    ctx.textAlign = 'center';
    ctx.fillText('FAVORITE', favCx, favY - 3);
    // Tagline + sub
    if (favKey) {
      const flavor = FAVORITE_FLAVOR[favKey];
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = colors[favKey];
      ctx.fillText(flavor.tag, favCx, favY + 6);
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = '#bbb';
      ctx.fillText(flavor.sub, favCx, favY + 19);
      ctx.font = '7px "Courier New", monospace';
      ctx.fillStyle = '#888';
      ctx.fillText(labels[favKey] + ' x' + favN, favCx, favY + 29);
    } else {
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = '#9eea9e';
      ctx.fillText('PRISTINE DRIVER', favCx, favY + 6);
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = '#bbb';
      ctx.fillText('Didn\'t need a single boost.', favCx, favY + 19);
    }

    // Prompt
    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#aaa';
    ctx.fillText('PRESS ENTER FOR CREDITS', W / 2, H - 14);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  // ---- Retirement page 1: FAVORITE blurbs ----
  // One tag-line per most-used powerup so the screen feels like it knows
  // how you played. Kept light — a friendly roast, not a callout.
  const FAVORITE_FLAVOR = {
    coffee: {
      tag: 'CAFFEINATED COMMUTER',
      sub: 'Sleep is for retirees. Oh wait...',
    },
    jump: {
      tag: 'ROAD ACROBAT',
      sub: 'When in doubt, hop it out.',
    },
    shortcut: {
      tag: 'GOD OF THUNDER',
      sub: 'Mortal speed limits don\'t apply.',
    },
    lofi: {
      tag: 'ZEN MASTER',
      sub: 'Rush hour? More like hush hour.',
    },
    wrench: {
      tag: 'BODY SHOP REGULAR',
      sub: 'Your mechanic sends Christmas cards.',
    },
  };

  // ---- Retirement: page 2 (scrolling credits) ----
  // Credit lines drift up from below the screen. ENTER returns to title.
  const CREDIT_LINES = [
    { text: 'RUSH HOUR RAGE',          style: 'title' },
    { text: '',                          style: 'gap' },
    { text: 'GAME DESIGN & DIRECTION',  style: 'role' },
    { text: 'Matthew Hessing',          style: 'name' },
    { text: '',                          style: 'gap' },
    { text: 'PROGRAMMING',              style: 'role' },
    { text: 'Claude (Sonnet, Opus)',    style: 'name' },
    { text: 'Matthew Hessing',          style: 'name' },
    { text: '',                          style: 'gap' },
    { text: 'PIXEL ART',                style: 'role' },
    { text: 'Matthew Hessing',          style: 'name' },
    { text: 'ChatGPT',                  style: 'name' },
    { text: '',                          style: 'gap' },
    { text: 'AUDIO DESIGN',             style: 'role' },
    { text: 'Claude',                   style: 'name' },
    { text: '(procedural Web Audio)',   style: 'sub'  },
    { text: '',                          style: 'gap' },
    { text: 'CONCEPT',                  style: 'role' },
    { text: 'Matthew Hessing',          style: 'name' },
    { text: '',                          style: 'gap' },
    { text: '',                          style: 'gap' },
    { text: 'SPECIAL THANKS',           style: 'role' },
    { text: 'You, the player.',         style: 'name' },
    { text: '',                          style: 'gap' },
    { text: 'Thanks for playing!',      style: 'farewell' },
    { text: '',                          style: 'gap' },
    { text: '',                          style: 'gap' },
    { text: 'PRESS ENTER TO RETURN',    style: 'prompt' },
  ];

  function drawRetiredCredits(ctx, scrollY) {
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';

    // Credits start fully below the visible area and scroll upward as
    // scrollY accumulates. baseY is where the FIRST line currently sits.
    const baseY = H - scrollY;

    let y = baseY;
    for (const line of CREDIT_LINES) {
      let lineH = 10;
      if (line.style === 'title') {
        ctx.font = 'bold 14px "Courier New", monospace';
        ctx.fillStyle = '#ffe060';
        lineH = 18;
      } else if (line.style === 'role') {
        ctx.font = 'bold 8px "Courier New", monospace';
        ctx.fillStyle = '#7aa9c8';
        lineH = 11;
      } else if (line.style === 'name') {
        ctx.font = '8px "Courier New", monospace';
        ctx.fillStyle = '#fff';
        lineH = 10;
      } else if (line.style === 'sub') {
        ctx.font = '7px "Courier New", monospace';
        ctx.fillStyle = '#aaa';
        lineH = 9;
      } else if (line.style === 'farewell') {
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillStyle = '#9eea9e';
        lineH = 14;
      } else if (line.style === 'prompt') {
        ctx.font = '8px "Courier New", monospace';
        ctx.fillStyle = '#888';
        lineH = 10;
      } else {
        lineH = 6;
      }
      // Cull lines that are well off-screen for very long rolls; render
      // only those that could intersect the canvas.
      if (y > -lineH && y < H && line.text) {
        ctx.fillText(line.text, W / 2, Math.round(y));
      }
      y += lineH;
    }

    // Always-visible skip prompt at the very bottom edge so the player
    // doesn't feel trapped if they want out before the scroll completes.
    ctx.font = '7px "Courier New", monospace';
    ctx.fillStyle = '#555';
    ctx.fillText('ENTER to return', W / 2, H - 9);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ':' + s.toString().padStart(2, '0');
  }
  function pct(p) { return Math.round(p * 100) + '%'; }
  function stressLabel(r) {
    if (r.raging) return 'RAGING';
    if (r.tier === 'low')  return 'Calm';
    if (r.tier === 'mid')  return 'Tense';
    return 'Stressed';
  }
  function stressColor(r) {
    if (r.raging) return '#ff6060';
    if (r.tier === 'low')  return '#9eea9e';
    if (r.tier === 'mid')  return '#ffe060';
    return '#ff8060';
  }

  function drawPause(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, C.INTERNAL_WIDTH, C.INTERNAL_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '16px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', C.INTERNAL_WIDTH / 2, C.INTERNAL_HEIGHT / 2 - 12);
    ctx.font = '8px "Courier New", monospace';
    ctx.fillText('press P or Esc to resume', C.INTERNAL_WIDTH / 2, C.INTERNAL_HEIGHT / 2 + 8);
    ctx.fillStyle = '#ff8060';
    ctx.fillText('press R to reset career', C.INTERNAL_WIDTH / 2, C.INTERNAL_HEIGHT / 2 + 22);
    ctx.textAlign = 'left';
  }

  return {
    clear, drawRoad, drawCar, drawBrakeLights, drawBlinker, drawHUD, drawPause, drawBanner,
    drawRoadRageVignette, drawShortcutFlash, drawCoffeeVignette,
    drawShoulderStrips, drawTireMarks,
    drawCareerSelect, drawShiftEnd, drawGameOver,
    drawRetiredStats, drawRetiredCredits,
  };
})();
