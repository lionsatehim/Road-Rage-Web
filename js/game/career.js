// Career system: track + level + city, three streak counters (promo / late /
// rage), lifetime earnings, and per-shift damage carried into next-shift
// repair cost. Persists to localStorage; clears on game over or retire.
//
// Streak rules (independent counters):
//   - on-time + sub-rage arrival → +1 promo, reset late streak, reset rage streak
//   - late                       → +1 late, reset promo
//   - raging at arrival          → +1 rage, reset promo (still pays nothing)
//   - both late AND raging       → +1 to both demote counters, reset promo
// Hitting a track's promoteStreak ⇒ promote (or retire from top rung at retirementTarget).
// Hitting demoteStreak ⇒ demote (or game over from bottom rung).
window.RR = window.RR || {};

RR.Career = (function () {
  const C = RR.Config;
  const SAVE_KEY = 'rushHourRage.career.v1';

  // Bare default — track is null until the player picks one.
  function emptyState() {
    return {
      track: null,
      levelIdx: 0,
      city: null,
      promoStreak: 0,
      lateStreak: 0,
      rageStreak: 0,
      lifetimeEarnings: 0,
      damage: 0,
      shiftsWorked: 0,
      // The most recent end-of-shift result (for the summary screen).
      lastResult: null,
      // Soft state for the running shift.
      shift: null,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      // Merge against fresh defaults so newly added fields don't break old saves.
      return Object.assign(emptyState(), parsed, { shift: null, lastResult: null });
    } catch (e) {
      return emptyState();
    }
  }

  function save(s) {
    try {
      const persisted = {
        track: s.track,
        levelIdx: s.levelIdx,
        city: s.city,
        promoStreak: s.promoStreak,
        lateStreak: s.lateStreak,
        rageStreak: s.rageStreak,
        lifetimeEarnings: s.lifetimeEarnings,
        damage: s.damage,
        shiftsWorked: s.shiftsWorked,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(persisted));
    } catch (e) { /* localStorage unavailable — silent */ }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  function trackCfg(s)  { return C.CAREERS.tracks[s.track]; }
  function levelCfg(s)  { return trackCfg(s).levels[s.levelIdx]; }

  // City assignment. Trades + Finance use a fixed ladder per level; Teacher
  // pulls a random city from a pool on each (re)assignment.
  function assignCity(s) {
    const tcfg = trackCfg(s);
    const lcfg = levelCfg(s);
    if (lcfg.city) {
      s.city = lcfg.city;
    } else if (tcfg.cities && tcfg.cities.length) {
      s.city = tcfg.cities[Math.floor(Math.random() * tcfg.cities.length)];
    } else {
      s.city = 'Unknown';
    }
  }

  // Pick a track. Resets streaks + level, keeps lifetime earnings cleared
  // because this is a new game.
  function pickTrack(s, trackKey) {
    s.track = trackKey;
    s.levelIdx = 0;
    s.promoStreak = 0;
    s.lateStreak = 0;
    s.rageStreak = 0;
    s.lifetimeEarnings = 0;
    s.damage = 0;
    s.shiftsWorked = 0;
    assignCity(s);
    save(s);
  }

  // Compute deadline (seconds) for the current shift. Cushion makes "on time"
  // more forgiving than just driving at target speed the whole way.
  function shiftDeadline() {
    const cc = C.CAREERS;
    const targetSpeed = C.CAR.maxSpeed * cc.targetAvgSpeedFrac;
    return (cc.shiftDistance / targetSpeed) * cc.deadlineCushion;
  }

  // Open a fresh shift. Repair cost is debited from lifetime earnings up
  // front so the shift-end summary can report the next net cleanly.
  function startShift(s) {
    const repair = repairCost(s);
    s.lifetimeEarnings = Math.max(0, s.lifetimeEarnings - repair);
    s.damage = 0;
    s.shift = {
      startedAt: 0,            // absolute time-zero is fine; we tick elapsed
      elapsed: 0,
      distance: 0,
      deadline: shiftDeadline(),
      preRepair: repair,
      finished: false,
    };
    save(s);
  }

  function tickShift(s, dt, distanceDelta) {
    if (!s.shift || s.shift.finished) return;
    s.shift.elapsed += dt;
    s.shift.distance += distanceDelta;
    if (s.shift.distance >= C.CAREERS.shiftDistance) {
      s.shift.finished = true;
    }
  }

  // Damage from collisions. Called by main on hit detection.
  function addDamage(s, kind) {
    const cc = C.CAREERS;
    if (kind === 'crash') s.damage += cc.damagePerCrash;
    else if (kind === 'tap') s.damage += cc.damagePerTap;
    else if (kind === 'ram') s.damage += cc.damagePerRam;
  }

  function repairCost(s) {
    const tcfg = trackCfg(s);
    return Math.round(s.damage * C.CAREERS.repairPerDamage * (tcfg.repairMult || 1));
  }

  // Compute stress tier from arrival rage, applying track-specific shifts
  // (Finance counts every tier as one easier).
  // Returns: 'low' | 'mid' | 'high' | 'rage'
  function stressTier(s, arrivalRage, inRoadRage) {
    const cc = C.CAREERS;
    if (inRoadRage || arrivalRage >= cc.rageOnArrivalThreshold) return 'rage';
    let tier = arrivalRage < cc.stressLow ? 0
             : arrivalRage < cc.stressHigh ? 1
             : 2;
    const shift = trackCfg(s).stressTierShift || 0;
    tier = Math.max(0, tier - shift);
    return ['low', 'mid', 'high'][tier];
  }

  // Apply teacher's "kids cheer" rage drop to the arrival reading. Scales
  // linearly with how early — drop=0 if late, max if dead-on min-time.
  function teacherCheerDrop(s, arrivalRage, elapsed, deadline) {
    const tcfg = trackCfg(s);
    if (s.track !== 'teacher') return 0;
    if (elapsed >= deadline) return 0;
    const earlyFrac = 1 - (elapsed / deadline);     // 0..1
    const min = tcfg.cheerMinDropPct || 0;
    const max = tcfg.cheerMaxDropPct || 0;
    return min + (max - min) * earlyFrac;
  }

  // Evaluate the shift on arrival. Mutates state (streaks, earnings, level)
  // and returns a result object for the summary screen.
  function finishShift(s, arrivalRage, inRoadRage) {
    const sh = s.shift;
    const cc = C.CAREERS;
    const lcfg = levelCfg(s);
    const tcfg = trackCfg(s);

    const elapsed = sh.elapsed;
    const deadline = sh.deadline;
    const late = elapsed > deadline;

    // Teacher cheer trims rage before the tier check.
    const cheerDrop = teacherCheerDrop(s, arrivalRage, elapsed, deadline);
    const adjustedRage = Math.max(0, arrivalRage - cheerDrop);
    const tier = stressTier(s, adjustedRage, inRoadRage);
    const raging = tier === 'rage';

    // ---- Pay computation ----
    let bonusPct = 0;
    let penaltyPct = 0;

    if (late) {
      const lateFrac = (elapsed - deadline) / deadline;
      penaltyPct = Math.min(cc.penaltyLateMaxPct, lateFrac);
    } else {
      const earlyFrac = (deadline - elapsed) / deadline;
      bonusPct = Math.min(cc.bonusEarlyMaxPct, earlyFrac);
    }

    // Stress tier modifies the bonus (or penalty when high-tier).
    if (!raging) {
      if (tier === 'low')  bonusPct += cc.stressLowBonusPct;
      if (tier === 'high') bonusPct -= cc.stressHighPenaltyPct;
    }

    const base = lcfg.basePay;
    let pay = raging ? 0 : Math.round(base * (1 + bonusPct - penaltyPct));
    if (pay < 0) pay = 0;

    s.lifetimeEarnings += pay;

    // ---- Streaks ----
    let promoted = false, demoted = false, gameOver = false, retired = false;

    // Late counter: any late shift increments; any on-time shift resets.
    if (late) s.lateStreak++; else s.lateStreak = 0;
    // Rage counter: arrival in rage increments; any sub-rage shift resets.
    if (raging) s.rageStreak++; else s.rageStreak = 0;
    // Promo counter: only on-time AND not raging.
    if (!late && !raging) s.promoStreak++; else s.promoStreak = 0;

    if (s.promoStreak >= (tcfg.promoteStreak || 3)) {
      s.promoStreak = 0; s.lateStreak = 0; s.rageStreak = 0;
      if (s.levelIdx < tcfg.levels.length - 1) {
        s.levelIdx++;
        promoted = true;
        assignCity(s);
      } else if (s.lifetimeEarnings >= cc.retirementTarget) {
        retired = true;
      } else {
        // Already at top rung but not yet retired — extra promo just rolls
        // back into a fresh streak counter (no double promotion).
      }
    } else if (s.lateStreak >= (tcfg.demoteStreak || 3) ||
               s.rageStreak >= (tcfg.demoteStreak || 3)) {
      s.promoStreak = 0; s.lateStreak = 0; s.rageStreak = 0;
      if (s.levelIdx > 0) {
        s.levelIdx--;
        demoted = true;
        assignCity(s);
      } else {
        gameOver = true;
      }
    }

    // Retirement can also fire on a top-rung shift even without promotion,
    // once cumulative earnings cross the threshold.
    if (!retired && !gameOver &&
        s.levelIdx === tcfg.levels.length - 1 &&
        s.lifetimeEarnings >= cc.retirementTarget) {
      retired = true;
    }

    s.shiftsWorked++;

    const result = {
      pay, base, bonusPct, penaltyPct,
      tier, raging, late,
      elapsed, deadline,
      arrivalRage, adjustedRage, cheerDrop,
      preRepair: sh.preRepair,
      damage: 0,                // damage was zeroed at startShift; live count is on s.damage
      promoted, demoted, gameOver, retired,
      newLevelTitle: tcfg.levels[s.levelIdx].title,
      newCity: s.city,
    };

    s.lastResult = result;
    s.shift = null;
    save(s);
    if (gameOver || retired) clearSave();
    return result;
  }

  // Promotion progress as a fraction (0..1) for the HUD.
  function promoProgress(s) {
    if (!s.track) return 0;
    return Math.min(1, s.promoStreak / (trackCfg(s).promoteStreak || 3));
  }

  return {
    load, save, clearSave, emptyState,
    pickTrack, assignCity,
    startShift, tickShift, finishShift,
    addDamage, repairCost,
    trackCfg, levelCfg,
    stressTier, promoProgress,
    shiftDeadline,
  };
})();
