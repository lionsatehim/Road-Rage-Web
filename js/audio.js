// Synthesized audio via the Web Audio API, with optional file overrides.
//
// Every voice (sfx, engine drone, lo-fi pad, etc.) has a procedural fallback.
// If RR.Config.AUDIO.files maps a name → URL and the file loads, it plays
// instead of the synth — so any cue can be replaced by dropping in a file.
//
// Browsers require a user gesture before audio can start, so we lazily
// initialize the AudioContext on the first keydown.
window.RR = window.RR || {};

RR.Audio = (function () {
  let ctx = null;
  let master = null;
  let started = false;
  let muted = false;
  let engine = null;
  let detunePulse = 0;        // small slow LFO for engine character
  const buffers = {};         // name → AudioBuffer (loaded files)
  let loadPromise = null;     // resolves once file loading attempts settle
  const lofi = { active: false, nodes: null, fileSrc: null };

  function ensureStart() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      loadPromise = loadFiles();
    }
    if (ctx.state === 'suspended') ctx.resume();
    if (!started) {
      started = true;
      // Wait for file loads to settle before starting engine, so the file
      // override (if any) is used from the first frame.
      loadPromise.then(() => startEngine());
    }
  }

  // Attempt to load every entry in Config.AUDIO.files. Failures are silent.
  function loadFiles() {
    const map = (RR.Config.AUDIO && RR.Config.AUDIO.files) || {};
    const jobs = [];
    for (const name in map) {
      const url = map[name];
      const job = fetch(url)
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { buffers[name] = buf; })
        .catch(() => { /* silent — fall back to synth */ });
      jobs.push(job);
    }
    return Promise.all(jobs);
  }

  // Play a loaded buffer. Returns the source node, or null if no buffer.
  function playBuffer(name, opts) {
    if (!ctx || muted) return null;
    const buf = buffers[name];
    if (!buf) return null;
    const o = opts || {};
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (o.loop) src.loop = true;
    if (o.playbackRate) src.playbackRate.value = o.playbackRate;
    const g = ctx.createGain();
    g.gain.value = (o.gain != null) ? o.gain : 1;
    src.connect(g).connect(master);
    src.start(o.at || ctx.currentTime);
    if (!o.loop && o.dur) src.stop((o.at || ctx.currentTime) + o.dur);
    return src;
  }

  // ---- Engine drone ----
  function startEngine() {
    // File override: play the loop, pitch via setEngine.
    const fileSrc = playBuffer('engine', { loop: true, gain: 0.4 });
    if (fileSrc) {
      engine = { fileSrc, g: null };
      return;
    }
    // Synth fallback.
    const o1 = ctx.createOscillator(); o1.type = 'square';   o1.frequency.value = 70;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 35;
    const g  = ctx.createGain();  g.gain.value = 0.0;
    o1.connect(g); o2.connect(g); g.connect(master);
    o1.start(); o2.start();
    engine = { o1, o2, g };
  }

  function setEngine(speedFrac, distortion) {
    if (!engine || !ctx) return;
    const t = ctx.currentTime;
    const clamped = Math.max(0, Math.min(1.4, speedFrac));

    if (engine.fileSrc) {
      // 0.7 idle → 1.3 full throttle
      const rate = 0.7 + 0.6 * clamped;
      engine.fileSrc.playbackRate.setTargetAtTime(rate, t, 0.05);
      return;
    }
    detunePulse += 0.05;
    const wob = Math.sin(detunePulse) * (distortion ? 18 : 4);
    const f  = 70 + 220 * clamped + wob;
    engine.o1.frequency.setTargetAtTime(f,        t, 0.04);
    engine.o2.frequency.setTargetAtTime(f * 0.5,  t, 0.04);
    const targetVol = muted ? 0 :
      (clamped < 0.01 ? 0.022 : (0.028 + 0.07 * Math.min(1, clamped)));
    engine.g.gain.setTargetAtTime(targetVol, t, 0.05);
  }

  // ---- Generic synth helpers (used by sfx fallback paths) ----
  function tone(freq, type, dur, vol, opts) {
    if (!ctx || muted) return;
    const o = opts || {};
    const t0 = (o.at != null) ? o.at : ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.glide != null) {
      osc.frequency.linearRampToValueAtTime(o.glide, t0 + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, vol, lpFreq, opts) {
    if (!ctx || muted) return;
    const o = opts || {};
    const t0 = (o.at != null) ? o.at : ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---- One-shot SFX ----
  // Always try a file override first. Synth fallback below covers each name.
  function sfx(name) {
    if (!ctx || muted) return;
    if (playBuffer(name)) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'horn':
        tone(440, 'square', 0.20, 0.10);
        tone(660, 'square', 0.20, 0.07);
        break;
      case 'hornMash':
        tone(310, 'sawtooth', 0.10, 0.10);
        tone(370, 'square',   0.10, 0.08);
        break;
      case 'crash':
        noiseBurst(0.35, 0.30, 1400);
        tone(110, 'square', 0.25, 0.12);
        tone(70,  'square', 0.30, 0.10);
        break;
      case 'tap':
        noiseBurst(0.08, 0.18, 2800);
        break;
      case 'ram':
        noiseBurst(0.22, 0.30, 1800);
        tone(140, 'square', 0.14, 0.10);
        break;
      case 'pass':
        tone(660, 'square', 0.06, 0.07, { at: t });
        tone(880, 'square', 0.06, 0.07, { at: t + 0.06 });
        break;
      case 'nearMiss':
        tone(900, 'triangle', 0.05, 0.08);
        break;
      case 'rageEnter':
        tone(90,  'sawtooth', 0.50, 0.13, { glide: 280 });
        tone(135, 'square',   0.50, 0.08, { glide: 420 });
        noiseBurst(0.35, 0.18, 800);
        break;
      case 'rageExit':
        tone(420, 'square', 0.25, 0.08, { glide: 110 });
        break;
      case 'pickup':
        tone(660, 'triangle', 0.06, 0.08, { at: t });
        tone(990, 'triangle', 0.08, 0.08, { at: t + 0.06 });
        break;
      case 'powerup':
        tone(440, 'square', 0.10, 0.09, { at: t,        glide: 880 });
        tone(660, 'square', 0.10, 0.07, { at: t + 0.05, glide: 1320 });
        break;
      case 'yeehaw':
        // Triumphant ascending whoop with vibrato — Dukes-of-Hazzard-ish.
        playYeehaw();
        break;
      case 'thunder':
        // Deep, lingering rumble + low pitch sweep for the shortcut bolt.
        noiseBurst(0.7, 0.40, 500);
        noiseBurst(0.4, 0.25, 1400, { at: t + 0.05 });
        tone(60, 'sawtooth', 0.55, 0.18, { glide: 30 });
        tone(45, 'square',   0.65, 0.12, { glide: 22 });
        break;
      case 'wrench':
        // Two metallic clinks + a happy ascending arpeggio = "fixed it".
        noiseBurst(0.04, 0.18, 4000, { at: t });
        noiseBurst(0.04, 0.16, 4000, { at: t + 0.08 });
        tone(523, 'square', 0.10, 0.08, { at: t + 0.18 });   // C5
        tone(659, 'square', 0.10, 0.08, { at: t + 0.26 });   // E5
        tone(784, 'square', 0.16, 0.09, { at: t + 0.34 });   // G5
        break;
    }
  }

  function playYeehaw() {
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(330, t0);
    osc.frequency.exponentialRampToValueAtTime(720, t0 + 0.18);
    osc.frequency.exponentialRampToValueAtTime(540, t0 + 0.32);
    osc.frequency.exponentialRampToValueAtTime(960, t0 + 0.55);
    // Vibrato via an LFO on frequency.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 28;
    lfo.connect(lfoGain).connect(osc.frequency);
    // Low-pass to take the edge off the saw.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.04);
    g.gain.setValueAtTime(0.13, t0 + 0.50);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.70);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t0); osc.stop(t0 + 0.75);
    lfo.start(t0); lfo.stop(t0 + 0.75);
  }

  // ---- Lo-fi pad loop ----
  // Three sustained voices forming a Cmaj9-ish chord (C E G B) with a slow
  // filter sweep and gentle volume LFO. Stopped by stopLofi().
  function startLofi() {
    if (!ctx || lofi.active) return;
    lofi.active = true;
    if (muted) return;

    const fileSrc = playBuffer('lofi', { loop: true, gain: 0.35 });
    if (fileSrc) { lofi.fileSrc = fileSrc; return; }

    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;

    // Slow filter sweep (LFO on cutoff).
    const filterLfo = ctx.createOscillator();
    filterLfo.frequency.value = 0.18;
    const filterLfoGain = ctx.createGain(); filterLfoGain.gain.value = 350;
    filterLfo.connect(filterLfoGain).connect(lp.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.6);

    // Volume LFO for breathing motion.
    const volLfo = ctx.createOscillator();
    volLfo.frequency.value = 0.35;
    const volLfoGain = ctx.createGain(); volLfoGain.gain.value = 0.025;
    volLfo.connect(volLfoGain).connect(g.gain);

    const freqs = [130.81, 164.81, 196.00, 246.94];   // C3 E3 G3 B3
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = (i % 2) ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      return o;
    });

    lp.connect(g).connect(master);
    filterLfo.start(t);
    volLfo.start(t);

    lofi.nodes = { oscs, lp, g, filterLfo, volLfo, melodyNotes: [] };

    // Eight-note melody loop riding on top of the pad. Pentatonic over the
    // Cmaj9 pad — every note belongs, nothing clashes. Plays at ~96 BPM
    // (250ms per eighth note, 2s full cycle).
    const beat = 0.25;                                     // sec per note
    const cycleLen = beat * 8;                             // 2s
    const melody = [
      659.25,  // E5
      783.99,  // G5
      987.77,  // B5
      880.00,  // A5
      783.99,  // G5
      659.25,  // E5
      587.33,  // D5
      523.25,  // C5
    ];

    function scheduleMelodyCycle(start) {
      for (let i = 0; i < melody.length; i++) {
        const note = playLofiNote(melody[i], start + i * beat, beat * 0.9);
        if (note) lofi.nodes.melodyNotes.push(note);
      }
      // Drop notes that have already finished so the list doesn't grow.
      const now = ctx.currentTime;
      lofi.nodes.melodyNotes = lofi.nodes.melodyNotes.filter(n => n.endAt > now);
    }

    let nextCycleAt = t + 0.6;   // wait for the pad fade-in to settle
    scheduleMelodyCycle(nextCycleAt);

    function pumpMelody() {
      if (!lofi.active) return;
      nextCycleAt += cycleLen;
      scheduleMelodyCycle(nextCycleAt);
      // Reschedule a bit before the next cycle should play so the audio
      // graph never runs dry.
      const leadMs = Math.max(80, (nextCycleAt - ctx.currentTime - 0.4) * 1000);
      lofi.nodes.melodyTimeout = setTimeout(pumpMelody, leadMs);
    }
    lofi.nodes.melodyTimeout = setTimeout(pumpMelody, (cycleLen - 0.4) * 1000);
  }

  // One soft triangle blip with a quick attack/decay envelope and a low-pass
  // for that lo-fi muffle. Only used by the synth fallback path. Returns a
  // handle so stopLofi can silence in-flight notes when the powerup ends.
  function playLofiNote(freq, at, dur) {
    if (!ctx || muted) return null;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(lp).connect(g).connect(master);
    const endAt = at + dur + 0.02;
    osc.start(at);
    osc.stop(endAt);
    return { osc, g, startAt: at, endAt };
  }

  function stopLofi() {
    if (!lofi.active) return;
    lofi.active = false;
    const t = ctx ? ctx.currentTime : 0;

    if (lofi.fileSrc) {
      try { lofi.fileSrc.stop(t + 0.4); } catch (_) {}
      lofi.fileSrc = null;
      return;
    }
    if (!lofi.nodes) return;
    const n = lofi.nodes;
    if (n.melodyTimeout) { clearTimeout(n.melodyTimeout); n.melodyTimeout = null; }
    // Cancel every queued melody note's envelope and stop its osc shortly
    // after — otherwise notes already pre-scheduled into the next cycle
    // keep playing for up to a full measure after the powerup expires.
    if (n.melodyNotes && n.melodyNotes.length) {
      for (const note of n.melodyNotes) {
        try {
          note.g.gain.cancelScheduledValues(t);
          note.g.gain.setValueAtTime(note.g.gain.value, t);
          note.g.gain.linearRampToValueAtTime(0.0001, t + 0.04);
          note.osc.stop(t + 0.06);
        } catch (e) { /* note may have already ended */ }
      }
      n.melodyNotes.length = 0;
    }
    n.g.gain.cancelScheduledValues(t);
    n.g.gain.setTargetAtTime(0.0001, t, 0.15);
    const stopAt = t + 0.6;
    for (const o of n.oscs) o.stop(stopAt);
    n.filterLfo.stop(stopAt);
    n.volLfo.stop(stopAt);
    lofi.nodes = null;
  }

  function setMuted(m) {
    muted = !!m;
    if (engine && engine.g && ctx) {
      engine.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    }
    if (muted) stopLofi();
  }
  function toggleMuted() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  return {
    ensureStart, setEngine, sfx,
    startLofi, stopLofi,
    setMuted, toggleMuted, isMuted,
  };
})();
