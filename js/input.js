// Keyboard input. Polls a held-keys map for movement, edge-triggers for events.
window.RR = window.RR || {};

RR.Input = (function () {
  const keys = {};
  const edges = {};

  const EDGE_CODES = new Set([
    'Escape', 'KeyP', 'KeyM',
    'Space', 'ShiftLeft', 'ShiftRight',
    'KeyL', 'Enter',
    'Digit1', 'Digit2', 'Digit3',
    'KeyR', 'KeyC',
  ]);

  window.addEventListener('keydown', (e) => {
    // Prevent page scroll on arrows / space
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    // First keydown unlocks the AudioContext (browser autoplay policy).
    if (window.RR && RR.Audio) RR.Audio.ensureStart();
    if (e.repeat) return;
    keys[e.code] = true;
    if (EDGE_CODES.has(e.code)) edges[e.code] = true;
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  function read() {
    const left  = keys['ArrowLeft']  || keys['KeyA'];
    const right = keys['ArrowRight'] || keys['KeyD'];
    const up    = keys['ArrowUp']    || keys['KeyW'];
    const down  = keys['ArrowDown']  || keys['KeyS'];
    return {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      accel: up   ? 1 : 0,
      brake: down ? 1 : 0,
    };
  }

  function consumeEdge(code) {
    if (edges[code]) { edges[code] = false; return true; }
    return false;
  }

  function consumePause() {
    return consumeEdge('Escape') || consumeEdge('KeyP');
  }

  // Multi-key chord: fires once when ALL listed keys are simultaneously
  // held. Re-arms only after at least one is released, so holding the
  // chord doesn't fire every frame. Used for hidden debug shortcuts.
  const chordsArmed = {};
  function consumeChord(codes) {
    const allDown = codes.every(c => keys[c]);
    const id = codes.join('+');
    if (allDown) {
      if (!chordsArmed[id]) { chordsArmed[id] = true; return true; }
      return false;
    }
    chordsArmed[id] = false;
    return false;
  }

  return { read, consumeEdge, consumePause, consumeChord };
})();
