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
    // Increase rates / amounts
    slowGain: 14,             // rage/sec at near-zero speed (scales linearly with slowFrac)
    slowSpeedThreshold: 0.55, // rage gain only when speed/maxSpeed below this
    brakeGain: 14,            // rage/sec while hard-braking from speed (>40px/s)
    passedBy: 6,              // rage points when an NPC passes the player
    nearMiss: 4,              // rage points per close approach without contact
    hornMashGain: 7,          // honk during cooldown
    crashBump: 22,            // rage spike on a hard crash
    // Decrease rates / amounts
    passBase: 3,              // base rage drained when player passes an NPC
    passCloseBonus: 5,        // additional drain for close passes
    smoothSpeedThreshold: 0.75, // (speed/maxSpeed) above this drains slowly
    smoothDrain: 3.5,         // rage/sec
    hornRelief: 8,            // honk on cooldown ready
    hornCooldown: 1.4,
    // Road Rage mode
    roadRageDuration: 10,
    roadRageExitLevel: 30,
    roadRageDrainRate: 12,
    roadRageSpeedBoost: 1.35,
    roadRageSteerBoost: 1.7,
    // Near-miss zone
    nearMissDx: 22,
    nearMissDy: 30,
    nearMissClearDx: 30,
    nearMissClearDy: 42,
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
    },
  },
  CAREERS:   { /* layer 4-5 */ },
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
      shortcut: { weight: 1, duration: 0,   advance: 320 },
      lofi:     { weight: 2, duration: 8.0, drainRate: 14 },
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
      texts: ['ZAP!', 'Warp!', 'Bypass!', 'Skip ahead!', 'Zoom!'],
    },
    lofi: {
      color: '#c870e0',
      texts: ['Chill tunes', 'Lo-fi vibes', 'Mellow mode', "Slowin' it down"],
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
  CITIES:    { /* layer 7 */ },
  PROMOTION: { /* layer 8 */ },
};
