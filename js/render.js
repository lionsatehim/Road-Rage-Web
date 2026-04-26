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
    ctx.fillText('RUSH HOUR', 4, 4);
    ctx.textAlign = 'right';
    ctx.fillText(mph + ' MPH', C.INTERNAL_WIDTH - 4, 4);
    ctx.textAlign = 'left';

    drawRageMeter(ctx, s.rage, t);
    drawPowerupSlot(ctx, s.powerups, t);
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
  };
})();
