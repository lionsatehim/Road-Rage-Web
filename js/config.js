// All tunable numbers live here. Each system has its own block.
window.RR = window.RR || {};

RR.Config = {
  INTERNAL_WIDTH: 256,
  INTERNAL_HEIGHT: 240,

  ROAD: {
    x: 86,           // (INTERNAL_WIDTH - width) / 2 to keep road centered
    width: 84,       // 3 lanes ~28px each — car (16) + half a car (8) clear
    lanes: 3,
    stripeH: 12,
    stripeGap: 12,
  },

  CAR: {
    width: 16,
    height: 24,
    screenY: 184,        // fixed vertical position on screen
    maxSpeed: 220,       // internal px/sec at base
    accel: 90,           // px/sec^2 — ~2.5s from 0 to max
    brake: 280,          // px/sec^2 — punchy
    idleDecel: 32,       // gentle natural slowdown
    lateralMaxSpeed: 120,
    lateralAccel: 9.5,   // exponential approach rate (1/sec)
    mphFactor: 0.5,      // display only: speed * factor = mph

  },

  RAGE: {
    // Rage meter is 0..100 with 10 segments; 1 "tick" = 10 rage.

    // ---- Gains ----
    brakeTap: 10,             // +1 tick the moment brake is pressed
    brakeHeldRate: 20,        // +1 tick per 0.5s held = +2 ticks/sec while held
    crashBump: 50,            // +50% bar on any contact (crash or tap)
    npcMergeAhead: 10,        // +1 tick when an NPC merges into your lane ahead
    passedBy: 10,             // +1 tick when a faster NPC overtakes you on either side
    hornMashGain: 7,          // honk during cooldown (kept from prior tuning)

    // ---- Drains ----
    maxSpeedDrain: 10,        // -1 tick/sec while sitting at top speed
    maxSpeedThreshold: 0.95,  // (speed/maxSpeed) ≥ this counts as "max speed"
    sidePass: 10,             // -1 tick per close-side overtake of an NPC
    sidePassDx: 32,           // |dx| at the moment of the pass to count as "on your side" (≈ adjacent lane)
    jumpLandReducePct: 33,    // -33% bar when you land a jump
    shortcutReducePct: 75,    // -75% bar when you trigger a shortcut
    coffeeImmediateDrop: 20,  // -20 rage the moment coffee activates
    coffeeGainMult: 1.5,      // multiplier on all rage gains while coffee is active

    // ---- Horn (kept from prior tuning) ----
    hornRelief: 8,
    hornCooldown: 1.4,

    // ---- Road Rage mode ----
    roadRageDuration: 10,
    roadRageExitLevel: 30,
    roadRageDrainRate: 12,
    roadRageSpeedBoost: 1.35,
    roadRageSteerBoost: 1.7,
    roadRageDamageMult: 0,    // RR is invincibility — no damage taken
  },

  // ---- Stubs for upcoming layers (kept so layout is visible) ----
  PAY:       { /* layer 5 */ },
  TRAFFIC: {
    spawnTarget: 6,           // target on-screen NPC count
    minLaneSeparation: 70,    // px in screen-y between same-lane NPCs at spawn
    crashStunTime: 1.8,       // both cars frozen this long after a hard crash
    npcBrakeDecel: 240,       // NPC max deceleration (px/sec^2) for perfect-braker physics
    followBuffer: 28,         // min gap (px) between NPC and lead car
    lightTapSpeedRetained: 0.85,
    lightTapKnock: 70,        // lateral velocity imparted by a glance
    lightTapThreshold: 0.18,  // |relSpeed|/playerMax below this = light tap
    archetypes: {
      cruiser:    { speedFrac: [0.55, 0.75], weight: 5 },
      slowpoke:   { speedFrac: [0.30, 0.50], weight: 3 },
      tailgater:  { speedFrac: [0.85, 1.05], weight: 2 },
      weaver:     { speedFrac: [0.55, 0.80], weight: 2 },
      brakeCheck: { speedFrac: [0.55, 0.75], weight: 1 },
      // Souped-up sport coupe: above player top speed, aggressively merges
      // around any car blocking the lane. Spawns from behind and passes.
      soupedUp:   { speedFrac: [1.05, 1.20], weight: 1, sportSprite: true },
    },
  },
  CAREERS: {
    // ---- Global shift parameters ----
    retirementTarget: 8000,      // lifetime $ to retire (win condition)
    shiftDistance: 6000,         // worldOffset px to reach the workplace
    targetAvgSpeedFrac: 0.7,     // fraction of maxSpeed used to compute deadline
    deadlineCushion: 1.25,       // multiplier on top of the target time

    // ---- Stress tiers (rage meter at arrival) ----
    rageOnArrivalThreshold: 90,  // ≥ this OR currently in Road Rage = "raging"
    stressLow: 33,               // < this = bottom third (bonus)
    stressHigh: 66,              // < stressHigh = middle, ≥ = top third (penalty)

    // ---- Pay shaping ----
    bonusEarlyMaxPct: 0.5,       // cap on early-arrival bonus (+50% of base)
    penaltyLateMaxPct: 1.0,      // cap on late deduction (-100% of base)
    stressLowBonusPct: 0.15,     // extra bonus when arriving in bottom-third stress
    stressHighPenaltyPct: 0.20,  // bonus reduction when arriving in top-third stress

    // ---- Damage / repair ----
    damagePerCrash: 35,          // hard-crash damage units
    damagePerTap: 6,
    damagePerRam: 10,
    repairPerDamage: 4,          // $ per damage unit (multiplied by track.repairMult)

    // ---- Tracks ----
    // Each track has its own promote/demote streak length (default 3) plus
    // signature flavor knobs and a 4-step ladder.
    tracks: {
      trades: {
        name: 'Skilled Trades',
        promoteStreak: 3,
        demoteStreak: 3,
        repairMult: 0.6,                 // signature: cheaper repairs
        passiveStressTotal: 66,          // rage accrued over a full shift if you do nothing about it
        // Inverted ladder: apprentices get the gnarly downtown gigs,
        // contractors pick easy suburban jobs.
        levels: [
          { title: 'Apprentice', basePay: 80,  city: 'Downtown',   trafficMult: 1.4, mapType: 'city' },
          { title: 'Technician', basePay: 110, city: 'Industrial', trafficMult: 1.2, mapType: 'exurb' },
          { title: 'Foreman',    basePay: 150, city: 'Suburban',   trafficMult: 1.0, mapType: 'suburb' },
          { title: 'Contractor', basePay: 220, city: 'Rural',      trafficMult: 0.7, mapType: 'rural' },
        ],
      },
      finance: {
        name: 'Finance',
        promoteStreak: 3,
        demoteStreak: 3,
        repairMult: 1.0,
        stressTierShift: 1,              // signature: each tier counts one easier
        passiveStressTotal: 100,         // rage accrued over a full shift if you do nothing about it
        levels: [
          { title: 'Bank Teller',     basePay: 70,  city: 'Suburbia',         trafficMult: 1.0, mapType: 'suburb' },
          { title: 'Bank Manager',    basePay: 130, city: 'Satellite Office', trafficMult: 1.1, mapType: 'exurb' },
          { title: 'Bank Executive',  basePay: 240, city: 'Downtown',         trafficMult: 1.3, mapType: 'city' },
          { title: 'CEO',             basePay: 420, city: 'Top Floor',        trafficMult: 1.5, mapType: 'city' },
        ],
      },
      teacher: {
        name: 'Teacher',
        promoteStreak: 3,
        demoteStreak: 3,
        repairMult: 1.0,
        // Signature: kids cheer on time/early, pulling rage down before stress
        // tier is computed (so a near-rage teacher can still earn a bonus).
        cheerMinDropPct: 5,
        cheerMaxDropPct: 25,
        passiveStressTotal: 33,          // rage accrued over a full shift if you do nothing about it
        // Cities are pulled at random on each (re)assignment instead of a
        // fixed ladder — teachers get whatever opening exists.
        cities: ['Riverside', 'Hilltop', 'Lakeside', 'Pine Grove', 'Oakwood', 'Greenfield'],
        levels: [
          { title: 'Substitute',      basePay: 50,  trafficMult: 1.0, mapType: 'suburb' },
          { title: 'New Teacher',     basePay: 75,  trafficMult: 1.0, mapType: 'suburb' },
          { title: 'Tenured Teacher', basePay: 105, trafficMult: 1.0, mapType: 'exurb' },
          { title: 'Principal',       basePay: 150, trafficMult: 1.0, mapType: 'exurb' },
        ],
      },
    },
  },
  POWERUPS: {
    // Pickup spawning
    spawnInterval: [4.5, 8.0],   // seconds between attempts
    spawnAheadY: -40,            // y where new pickups appear (just off-screen above)
    pickupW: 14,
    pickupH: 14,
    // Per-type definitions. duration=0 means instant.
    types: {
      // Coffee: NPCs slow down, player + road stay at full speed — the
      // player perceives + reacts faster than other drivers. Player also
      // gets sharper accel/steering and may drift onto the shoulder.
      coffee:   { weight: 4, duration: 6.0, npcTimeScale: 0.55,
                  steerBoost: 1.5, accelBoost: 1.6, shoulderExtra: 14,
                  exitGrace: 0.5 },
      jump:     { weight: 3, duration: 0.7, hopHeight: 10, exitGrace: 0.4 },
      // Lightning: clears every car and hazard on screen. No "warp" forward —
      // it's a clean-room reset. Visual flash via the existing shock timer.
      shortcut: { weight: 1, duration: 0 },
      lofi:     { weight: 2, duration: 8.0, drainRate: 14, maxSpeedMph: 65 },
      // Wrench: instant repair, percentage rolled at activation.
      //   low (50%) → 25% damage repaired
      //   med (35%) → 50%
      //   full (15%)→ 100%
      wrench:   { weight: 2, duration: 0,
                  tiers: [
                    { roll: 0.50, fraction: 0.25, label: 'low' },
                    { roll: 0.85, fraction: 0.50, label: 'medium' },
                    { roll: 1.00, fraction: 1.00, label: 'full' },
                  ] },
    },
  },

  // Power-up activation banners. One config entry per pickup type — the
  // banner picks a random string from `texts` on each activation so the same
  // pickup feels fresh on repeat. `color` shows up in the banner text fill.
  BANNERS: {
    coffee: {
      color: '#e0a040',
      texts: ['Coffee time!', 'Caffeinated!', 'Espresso shot!', 'Beans engaged!'],
    },
    jump: {
      color: '#60c8ff',
      texts: ['Yee-haw!', 'Yippee!', 'Hyup!', 'Boing!'],
    },
    shortcut: {
      color: '#ffe060',
      texts: ['ZAP!', 'KAPOW!', 'BLAMMO!', 'POOF!', 'CLEARED!', 'BZZZT!', 'VAPORIZED!'],
    },
    lofi: {
      color: '#c870e0',
      texts: ['Chill tunes', 'Lo-fi vibes', 'Mellow mode', "Slowin' it down"],
    },
    wrench: {
      // Tier-specific text is selected at activation in main.js; this entry
      // is only the fallback used if a custom banner isn't supplied.
      color: '#ff8030',
      texts: ['Repaired!'],
    },
    pothole: {
      color: '#ff9040',
      texts: ['THWACK!', 'KLUNK!', 'WHOMP!', 'KA-THUNK!', 'BUMP!', 'KRUNCH!'],
    },
    puddle: {
      color: '#60c8ff',
      texts: ['SPLASH!', 'SPLOOSH!', 'SQUISH!', 'KER-PLUNK!', 'SOAKED!'],
    },
    oil: {
      color: '#c8a0ff',
      texts: ['SLIIICK!', 'WHEEEE...', 'WHOOPS!', 'SLIIIDE!', 'GREASY!'],
    },
    cones: {
      color: '#ff8030',
      texts: ['BWOMP!', 'SCATTER!', 'CLANK!', 'CRUNCH!', 'YOINK!'],
    },
    stoppedCar: {
      color: '#ff5050',
      texts: ['BREAKDOWN!', 'PARKED!', 'WHAM!', 'SMASHED!', 'OUCH!'],
    },
  },

  // Audio overrides. Map any sfx, engine, or music name → file URL. If the
  // file loads, it replaces the synthesized fallback. Leave empty to use
  // procedural audio. Loops (engine, lofi) play with `loop: true`.
  AUDIO: {
    files: {
      // Examples:
      // horn:    'audio/horn.wav',
      // crash:   'audio/crash.wav',
      // engine:  'audio/engine-loop.ogg',
      // lofi:    'audio/lofi-loop.mp3',
      // yeehaw:  'audio/yeehaw.wav',
      // thunder: 'audio/thunder.wav',
    },
  },
  // Sprite overrides. Each vehicle class can supply a PNG sprite sheet —
  // a horizontal strip of `frames` images at 16x24 each (or whatever the
  // sheet dimensions are; the loader infers frame width from image.width
  // / frames).
  //
  // Damage progression: frame 0 = pristine, last frame = wrecked, with
  // the intermediate frames mapped to damage tiers. NPCs flip directly to
  // the last frame on crash. The player frame is driven live by
  // state.career.damage against damageMax via damageThresholds.
  //
  // Tint pipeline: at load time we bake one offscreen canvas per
  // (frame × tint) using `multiply` blend, so a single grayscale sheet
  // can produce N color variants. Pure-black pixels in the sheet
  // (windows, wheels, brake lights, etc.) survive any tint untouched. If
  // a sheet fails to load, the vehicle falls back to the procedural
  // sprite as today.
  SPRITES: {
    damageMax: 100,                       // "totaled" threshold (player)
    damageThresholds: [0.34, 0.67, 1.0],  // tier transitions (player)
    vehicles: {
      sedan: {
        url: 'sprites/sedan.png',
        frames: 4,
        tints: ['#3c6ec8', '#3ca050', '#f0c83c',
                '#dc8232', '#9650b4', '#c8c8d2'],
      },
      sport: {
        // url: 'sprites/sport.png',
        frames: 4,
        tints: ['#282832'],
      },
      // Player car. Damage frame is driven live by state.career.damage
      // against damageMax above. The sheet additionally has Road Rage
      // overlays auto-baked at load (red + yellow flicker) so the
      // star-power flash works on file art the same way it does on the
      // procedural sprite. Single tint by default — change to a list of
      // colors if you want player car selection later.
      player: {
        url: 'sprites/player.png',
        frames: 4,
        tints: ['#eeeeee'],
      },
    },
    // Road Rage flash overlays applied on top of the body-tinted player
    // frame, alternating per draw tick. Plain rgba so they read as a
    // wash, not a recolor — windows and dark detail still show through.
    rageTints: {
      red:    'rgba(230,  50,  50, 0.55)',
      yellow: 'rgba(255, 220,  60, 0.60)',
    },
  },
  // ---- Map types ----
  // Backgrounds tied to a career level via `mapType`. Each entry defines the
  // off-road palette and the set-piece roster (sprite name -> weight) the map
  // module draws while scrolling. spawnInterval is seconds-between-pieces;
  // shorter = denser scenery.
  MAPS: {
    rural: {
      groundColor: '#2c4a1d',
      accentColor: '#3d6a2a',
      accentPeriod: 32,
      spawnInterval: [0.7, 1.4],
      lanes: { min: 2, max: 2, segment: [9999, 9999], transition: 60 },
      pieces: [
        { name: 'tree', weight: 6 },
        { name: 'bush', weight: 4 },
        { name: 'hay',  weight: 1 },
      ],
    },
    suburb: {
      groundColor: '#3a5a3a',
      accentColor: '#4d6d4d',
      accentPeriod: 28,
      spawnInterval: [0.45, 0.9],
      lanes: { min: 2, max: 4, segment: [800, 1500], transition: 80 },
      pieces: [
        { name: 'house',   weight: 4 },
        { name: 'shrub',   weight: 4 },
        { name: 'mailbox', weight: 2 },
        { name: 'tree',    weight: 1 },
      ],
    },
    exurb: {
      groundColor: '#56564a',
      accentColor: '#66665a',
      accentPeriod: 24,
      spawnInterval: [0.35, 0.7],
      lanes: { min: 3, max: 5, segment: [600, 1200], transition: 80 },
      pieces: [
        { name: 'apartment', weight: 4 },
        { name: 'sign',      weight: 2 },
        { name: 'shrub',     weight: 2 },
        { name: 'house',     weight: 1 },
      ],
    },
    city: {
      groundColor: '#3a3a40',
      accentColor: '#4a4a52',
      accentPeriod: 20,
      spawnInterval: [0.25, 0.55],
      lanes: { min: 4, max: 5, segment: [500, 1000], transition: 80 },
      pieces: [
        { name: 'tower',       weight: 5 },
        { name: 'streetlight', weight: 3 },
        { name: 'billboard',   weight: 2 },
      ],
    },
  },
  PROMOTION: { /* layer 8 */ },

  // ---- Hazards ----
  // On-road obstacles. Each type defines its own footprint, draw style,
  // and hit effect (rage bump, damage, speed kick, lateral knock, shock).
  // Per-map rosters control which types appear where + at what density.
  HAZARDS: {
    spawnAheadY: -16,
    types: {
      pothole: {
        width: 14, height: 8,
        rageBump: 12, damage: 4,
        speedKick: 0.55, lateralKnock: 0,
        shock: 0.4, banner: 'pothole',
      },
      puddle: {
        // Wider footprint; light rage, no damage, but knocks you sideways
        // as the tires hydroplane.
        width: 22, height: 10,
        rageBump: 5, damage: 0,
        speedKick: 0.85, lateralKnock: 60,
        shock: 0.2, banner: 'puddle',
      },
      oil: {
        // Slipperier than water — bigger lateral knock, modest speed loss.
        width: 22, height: 11,
        rageBump: 8, damage: 0,
        speedKick: 0.78, lateralKnock: 110,
        shock: 0.3, banner: 'oil',
      },
      cones: {
        // Small but punishing — clipping a cone is a clear "you screwed up".
        width: 10, height: 12,
        rageBump: 10, damage: 3,
        speedKick: 0.7, lateralKnock: 0,
        shock: 0.3, banner: 'cones',
      },
      stoppedCar: {
        // Broken-down vehicle parked on the shoulder. Only a threat if the
        // player drifts off-road (coffee shoulder slack, evasive swerve).
        // Hits like a wall: full stop + stun, big rage bump.
        width: 16, height: 24,
        rageBump: 25, damage: 22,
        speedKick: 0, lateralKnock: 0,
        shock: 0.6, banner: 'stoppedCar',
        placement: 'shoulder', stun: true,
      },
    },
    // Per-map roster (type → spawn weight) and mean spawn interval (sec).
    // Shoulder-stopped cars are uncommon — one or two per shift on average.
    perMap: {
      rural:  { interval: [3.5, 6.0], roster: { pothole: 5, puddle: 3, stoppedCar: 1 } },
      suburb: { interval: [2.4, 4.0], roster: { pothole: 5, puddle: 2, cones: 1, stoppedCar: 1 } },
      exurb:  { interval: [1.8, 3.2], roster: { pothole: 4, oil: 2, cones: 3, stoppedCar: 1 } },
      city:   { interval: [1.4, 2.6], roster: { pothole: 2, oil: 4, cones: 4, stoppedCar: 1 } },
    },
  },

  // ---- Style points ----
  // Parallel scoring system rewarding flashy / risky play. Independent of
  // pay & promotions. Each event awards a fixed value (or a Fibonacci-6
  // streak value for chained passes / RR hits). Shown as small floaters
  // near the player and accumulated into a per-shift + lifetime total.
  STYLE: {
    // Streak schedule (capped at index 5). Index resets on streak break.
    streakFib: [100, 200, 300, 500, 800, 1300],
    rageStreakFib: [200, 400, 600, 1000, 1600, 2600],

    // Flat values
    powerup: 250,
    nearMiss: 300,
    narrowMerge: 400,
    fastDodge: 200,
    hazardHop: 250,
    clearance: 500,
    airtimeBase: 300,        // first jump
    airtimeIncrement: 200,   // additional per jump after the first
    offRoadPerSec: 40,       // scaled by speed/maxSpeed; only when moving
    offRoadMinSpeedFrac: 0.3,// no points for crawling along the shoulder

    // Shift-complete bonus: base * (levelIdx + 1) plus modest extras.
    shiftComplete: 1000,
    shiftCompleteOnTime: 500,
    shiftCompleteNoRage: 500,

    // Detection thresholds
    nearMissDy: 28,          // NPC ahead within this y is in "near-miss" range
    nearMissCooldown: 1.2,   // seconds; one near-miss credit per encounter
    narrowMergeWindowDy: 30, // y window around player for flanking NPC check
    narrowMergeMinLatVel: 30,// |lateralVel| above this counts as merging
    narrowMergeCooldown: 0.6,
    fastDodgeDx: 18,         // hazard within this dx as it crosses the player
    fastDodgeMinLatVel: 30,

    // Floater visual
    floaterLife: 0.9,        // seconds total
    floaterRise: 18,         // px rise over life
    floaterSpacing: 10,      // min vertical gap between stacked floaters
  },
};
