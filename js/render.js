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
    const W = C.INTERNAL_WIDTH;
    const H = C.INTERNAL_HEIGHT;

    // Roadside (grass)
    ctx.fillStyle = '#1d4a1d';
    ctx.fillRect(0, 0, r.x, H);
    ctx.fillRect(r.x + r.width, 0, W - r.x - r.width, H);

    // Roadside detail — scrolling tufts so motion is readable on the edges
    ctx.fillStyle = '#2a6a2a';
    const period = 32;
    const off = ((worldOffset * 0.6) % period + period) % period;
    for (let y = -period + (off | 0); y < H; y += period) {
      ctx.fillRect(8, y, 6, 6);
      ctx.fillRect(22, y + 14, 4, 4);
      ctx.fillRect(W - 14, y + 6, 6, 6);
      ctx.fillRect(W - 28, y + 20, 4, 4);
    }

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

  function drawCar(ctx, car, raging, jumpH, invincT) {
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
    const sprite = raging ? RR.Sprites.PLAYER_RAGING : RR.Sprites.PLAYER;
    RR.Sprites.draw(ctx, sprite, x, y);
    ctx.globalAlpha = 1;
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

    // Road Rage indicator
    if (rage.roadRageTimer > 0) {
      const pulse = (Math.sin(t * 14) + 1) * 0.5;
      ctx.strokeStyle = pulse > 0.5 ? '#ff6060' : '#ffaa00';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 3, y0 - 3, barW + 6, segH + 6);
      ctx.fillStyle = pulse > 0.5 ? '#ff6060' : '#ffaa00';
      ctx.font = '8px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('RAGE!', C.INTERNAL_WIDTH / 2, y0 + segH + 8);
      ctx.textAlign = 'left';
    }
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
  function drawShoulderStrips(ctx, powerups) {
    const slack = RR.Powerups.shoulderSlack(powerups);
    if (slack < 0.5) return;
    const cfgExtra = RR.Config.POWERUPS.types.coffee.shoulderExtra || 1;
    const intensity = Math.min(1, slack / cfgExtra);
    const r = C.ROAD;
    const H = C.INTERNAL_HEIGHT;
    const a = (0.18 * intensity).toFixed(3);
    ctx.fillStyle = 'rgba(230, 160, 60, ' + a + ')';
    ctx.fillRect(r.x - slack, 0, slack, H);
    ctx.fillRect(r.x + r.width, 0, slack, H);

    // Dashed amber line at the live outer boundary — moves inward smoothly as
    // slack decays so the player sees the drivable zone retracting.
    ctx.fillStyle = 'rgba(255, 200, 90, ' + (0.55 * intensity).toFixed(3) + ')';
    const dashH = 6, gap = 4;
    for (let y = 0; y < H; y += dashH + gap) {
      ctx.fillRect(Math.round(r.x - slack), y, 1, dashH);
      ctx.fillRect(Math.round(r.x + r.width + slack - 1), y, 1, dashH);
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

    const mph = Math.round(s.car.speed * C.CAR.mphFactor);
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
    ctx.textAlign = 'right';
    ctx.fillText(mph + ' MPH', C.INTERNAL_WIDTH - 4, 4);
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

    // Lifetime earnings + promo dots, bottom-right.
    const tcfg = RR.Career.trackCfg(car);
    ctx.fillStyle = '#9eea9e';
    ctx.fillText('$' + car.lifetimeEarnings, W - 4, H - 22);
    ctx.fillStyle = '#aaa';
    ctx.fillText('REPAIR $' + RR.Career.repairCost(car), W - 4, H - 12);

    // Promo dots: filled per current promoStreak, hollow for needed total.
    const need = tcfg.promoteStreak || 3;
    const dotY = H - 32, dotR = 3;
    let dotX = W - 6;
    for (let i = need - 1; i >= 0; i--) {
      const filled = i < car.promoStreak;
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = filled ? '#7fe07f' : '#222';
      ctx.fill();
      ctx.strokeStyle = '#7fe07f';
      ctx.lineWidth = 1;
      ctx.stroke();
      dotX -= dotR * 2 + 2;
    }
    ctx.textAlign = 'left';
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
    const usable = p.inventory && !p.active;
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
  function drawCareerSelect(ctx, t) {
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, W, H);

    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe060';
    ctx.fillText('RUSH HOUR RAGE', W / 2, 22);

    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText('PICK YOUR CAREER', W / 2, 38);

    const tracks = [
      { key: '1', name: 'Skilled Trades', tag: 'Balanced',  color: '#9eea9e' },
      { key: '2', name: 'Finance',        tag: '$$$ / High stress', color: '#ffe060' },
      { key: '3', name: 'Teacher',        tag: 'Low pay / Low stress', color: '#a0d8ff' },
    ];

    const rowH = 38;
    const startY = 60;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      const y = startY + i * rowH;
      ctx.fillStyle = '#1c2a36';
      ctx.fillRect(20, y, W - 40, rowH - 6);
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(20.5, y + 0.5, W - 41, rowH - 7);

      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = tr.color;
      ctx.fillText(tr.key + '.', 28, y + 8);
      ctx.fillStyle = '#fff';
      ctx.fillText(tr.name, 44, y + 8);
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = '#9aa';
      ctx.fillText(tr.tag, 44, y + 22);
    }

    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = pulse > 0.5 ? '#fff' : '#888';
    ctx.fillText('PRESS 1, 2, OR 3', W / 2, H - 14);

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

    const boxX = 16, boxW = W - 32;
    const boxY = 22, boxH = H - 44;
    ctx.fillStyle = '#0e1620';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px "Courier New", monospace';

    let header = 'SHIFT COMPLETE';
    let headColor = '#9eea9e';
    if (r.raging) { header = 'YOU ARRIVED IN A RAGE'; headColor = '#ff6060'; }
    else if (r.late) { header = 'YOU WERE LATE'; headColor = '#ffaa40'; }
    ctx.fillStyle = headColor;
    ctx.fillText(header, W / 2, boxY + 6);

    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'left';
    let y = boxY + 22;
    const lx = boxX + 8, rx = boxX + boxW - 8;

    function row(label, value, color) {
      ctx.fillStyle = '#aaa';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx, y);
      ctx.fillStyle = color || '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(value, rx, y);
      y += 10;
    }

    row('Time', formatTime(r.elapsed) + ' / ' + formatTime(r.deadline),
        r.late ? '#ff8060' : '#9eea9e');
    row('Stress', stressLabel(r), stressColor(r));
    if (r.cheerDrop > 0) {
      row('Kids cheered', '-' + Math.round(r.cheerDrop) + ' rage', '#a0d8ff');
    }
    y += 2;
    row('Base pay',  '$' + r.base,  '#fff');
    if (r.bonusPct > 0) {
      row('Bonus',   '+' + pct(r.bonusPct), '#9eea9e');
    }
    if (r.penaltyPct > 0) {
      row('Late penalty', '-' + pct(r.penaltyPct), '#ff8060');
    }
    if (r.preRepair > 0) {
      row('Repair (last)', '-$' + r.preRepair, '#ff8060');
    }
    y += 2;
    ctx.fillStyle = '#222';
    ctx.fillRect(lx, y - 2, boxW - 16, 1);
    row('PAY', '$' + r.pay, r.pay > 0 ? '#9eea9e' : '#888');
    y += 2;
    row('Lifetime',   '$' + career.lifetimeEarnings, '#ffe060');

    // Promo / demo ribbon.
    if (r.promoted) {
      drawRibbon(ctx, '★ PROMOTED ★', r.newLevelTitle + ' — ' + r.newCity, '#ffe060', boxX, boxY + boxH - 36, boxW);
    } else if (r.demoted) {
      drawRibbon(ctx, '▼ DEMOTED ▼', r.newLevelTitle + ' — ' + r.newCity, '#ff8060', boxX, boxY + boxH - 36, boxW);
    } else {
      drawStreakRow(ctx, career, r, boxX, boxY + boxH - 32, boxW);
    }

    // Continue prompt.
    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#aaa';
    ctx.fillText('PRESS ENTER', W / 2, boxY + boxH - 10);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  function drawRibbon(ctx, head, sub, color, x, y, w) {
    ctx.fillStyle = '#1c2a36';
    ctx.fillRect(x + 4, y, w - 8, 22);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 4.5, y + 0.5, w - 9, 21);
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(head, x + w / 2, y + 4);
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(sub, x + w / 2, y + 14);
  }

  function drawStreakRow(ctx, career, r, x, y, w) {
    const tcfg = RR.Career.trackCfg(career);
    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#aaa';
    ctx.fillText('Promo', x + 8, y);
    drawDots(ctx, x + 50, y + 4, career.promoStreak, tcfg.promoteStreak || 3, '#9eea9e');

    ctx.fillStyle = '#aaa';
    ctx.fillText('Late',  x + 8, y + 12);
    drawDots(ctx, x + 50, y + 16, career.lateStreak, tcfg.demoteStreak || 3, '#ffaa40');

    ctx.fillStyle = '#aaa';
    ctx.fillText('Rage',  x + w / 2 + 8, y + 12);
    drawDots(ctx, x + w / 2 + 50, y + 16, career.rageStreak, tcfg.demoteStreak || 3, '#ff6060');
    ctx.textAlign = 'left';
  }

  function drawDots(ctx, x, y, filled, total, color) {
    for (let i = 0; i < total; i++) {
      const cx = x + i * 8;
      ctx.beginPath();
      ctx.arc(cx, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = i < filled ? color : '#222';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
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
    ctx.fillStyle = '#aaa';
    ctx.fillText('Press R or Enter to start over', W / 2, H / 2 + 26);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  function drawRetired(ctx, career) {
    const W = C.INTERNAL_WIDTH, H = C.INTERNAL_HEIGHT;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe060';
    ctx.fillText('RETIRED', W / 2, H / 2 - 36);
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('Congratulations.', W / 2, H / 2 - 14);
    ctx.fillText('You hit the magic number.', W / 2, H / 2 - 4);
    ctx.fillStyle = '#9eea9e';
    ctx.fillText('Lifetime earnings: $' + career.lifetimeEarnings, W / 2, H / 2 + 14);
    ctx.fillStyle = '#aaa';
    ctx.fillText('Shifts worked: ' + career.shiftsWorked, W / 2, H / 2 + 24);
    ctx.fillText('Press R or Enter for a new life', W / 2, H / 2 + 40);
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
    ctx.fillText('PAUSED', C.INTERNAL_WIDTH / 2, C.INTERNAL_HEIGHT / 2 - 8);
    ctx.font = '8px "Courier New", monospace';
    ctx.fillText('press P or Esc to resume', C.INTERNAL_WIDTH / 2, C.INTERNAL_HEIGHT / 2 + 12);
    ctx.textAlign = 'left';
  }

  return {
    clear, drawRoad, drawCar, drawHUD, drawPause, drawBanner,
    drawRoadRageVignette, drawShortcutFlash, drawCoffeeVignette,
    drawShoulderStrips, drawTireMarks,
    drawCareerSelect, drawShiftEnd, drawGameOver, drawRetired,
  };
})();
