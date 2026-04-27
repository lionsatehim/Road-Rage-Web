// Variable lanes. The road's lane count can change mid-shift; this module
// owns the per-shift schedule of segments along worldOffset and the live
// geometry (edges, lane centers) used by the rest of the game.
//
// Geometry is centered on the canvas (INTERNAL_WIDTH / 2). When lane count
// changes the road expands/contracts symmetrically — both edges move by
// half the new-lane width. Lane centers shift slightly per change; NPCs
// glide to new centers via their existing approach() lateral inertia, so
// the drift looks like a smooth merge rather than a snap.
//
// A transition zone spans `transitionLen` px centered on each segment
// boundary. During the zone:
//   - visualLanes (float) interpolates from prev → current
//   - activeLanes = min(prev, current) — only the lanes that exist throughout
//     are valid spawn / target positions, so traffic doesn't appear in
//     half-formed lanes
//   - the symmetric "ghost" strip on each side shows orange dotted markers
//     warning of the lane that's appearing / disappearing
window.RR = window.RR || {};

RR.Road = (function () {
  const C = RR.Config;
  const LANE_W = 28;

  function buildSchedule(mapType, totalDistance) {
    const cfg = C.MAPS[mapType] || C.MAPS.suburb;
    const lanesCfg = (cfg && cfg.lanes) ||
      { min: 3, max: 3, segment: [totalDistance, totalDistance], transition: 80 };
    const minL = lanesCfg.min;
    const maxL = lanesCfg.max;
    const [segLo, segHi] = lanesCfg.segment;
    const segs = [];
    let pos = 0;
    let prevCount = null;
    // Build segments slightly past the end so we always have a defined road
    // at any worldOffset the player might reach.
    while (pos < totalDistance + 400) {
      let count;
      if (minL === maxL) {
        count = minL;
      } else {
        for (let attempt = 0; attempt < 6; attempt++) {
          count = minL + Math.floor(Math.random() * (maxL - minL + 1));
          if (count !== prevCount) break;
        }
      }
      const segLen = segLo + Math.random() * (segHi - segLo);
      const end = pos + segLen;
      segs.push({ start: pos, end, lanes: count });
      pos = end;
      prevCount = count;
    }
    return segs;
  }

  function create(mapType, totalDistance) {
    const cfg = C.MAPS[mapType] || C.MAPS.suburb;
    const transitionLen = (cfg.lanes && cfg.lanes.transition) || 80;
    const road = {
      schedule: buildSchedule(mapType, totalDistance),
      transitionLen,
      // current logical lane count (post-boundary value of the segment we're in)
      lanes: 3,
      prevLanes: 3,
      // active lanes for spawning / targeting (== min(prev,cur) in transition)
      activeLanes: 3,
      // float lane count for visual width interpolation
      visualLanes: 3,
      // 0 outside transition; 0..1 (peaks at 0.5 mid-zone) inside
      transitionT: 0,
      transitionDir: 0,            // -1 closing, +1 opening
      leftEdge: 0, rightEdge: 0, width: 0,
    };
    update(road, 0);
    return road;
  }

  // Road geometry at any worldY position. Used both by `update` (player's
  // current worldY → live state for clamping/spawning) and by `draw`
  // (per-screen-row geometry, so a transition is visible in the distance
  // and scrolls down with the player's speed).
  function geometryAt(road, wy) {
    const sched = road.schedule;
    let segIdx = sched.length - 1;
    for (let i = 0; i < sched.length; i++) {
      if (wy < sched[i].end) { segIdx = i; break; }
    }
    const seg = sched[segIdx];
    const prevSeg = segIdx > 0 ? sched[segIdx - 1] : seg;
    const transHalf = road.transitionLen / 2;
    const distFromBoundary = wy - seg.start;
    const inTransition =
      segIdx > 0 &&
      distFromBoundary >= -transHalf &&
      distFromBoundary < transHalf &&
      seg.lanes !== prevSeg.lanes;

    let visualLanes = seg.lanes;
    let activeLanes = seg.lanes;
    let transitionT = 0;
    let transitionAlpha = 0;
    let transitionDir = 0;
    if (inTransition) {
      const t = (distFromBoundary + transHalf) / road.transitionLen;
      visualLanes = prevSeg.lanes + (seg.lanes - prevSeg.lanes) * t;
      activeLanes = Math.min(prevSeg.lanes, seg.lanes);
      transitionT = 1 - 2 * Math.abs(t - 0.5);
      transitionAlpha = t;
      transitionDir = seg.lanes > prevSeg.lanes ? 1 : -1;
    }
    return { lanes: seg.lanes, prevLanes: prevSeg.lanes, visualLanes, activeLanes, transitionT, transitionAlpha, transitionDir };
  }

  // Widest the road ever gets across the whole shift — used by map deco
  // placement so set pieces never end up under a wider future segment.
  function maxWidth(road) {
    let m = 0;
    for (const seg of road.schedule) {
      if (seg.lanes * LANE_W > m) m = seg.lanes * LANE_W;
    }
    return m;
  }

  function update(road, worldOffset) {
    road.worldOffset = worldOffset;
    const g = geometryAt(road, worldOffset);
    road.lanes = g.lanes;
    road.prevLanes = g.prevLanes;
    road.activeLanes = g.activeLanes;
    road.visualLanes = g.visualLanes;
    road.transitionT = g.transitionT;
    road.transitionDir = g.transitionDir;

    const center = C.INTERNAL_WIDTH / 2;
    const w = g.visualLanes * LANE_W;
    road.leftEdge = center - w / 2;
    road.rightEdge = center + w / 2;
    road.width = w;
  }

  function bounds(road) {
    return { x: road.leftEdge, width: road.width, lanes: road.activeLanes };
  }

  function laneCenters(road) {
    const center = C.INTERNAL_WIDTH / 2;
    const w = road.activeLanes * LANE_W;
    const left = center - w / 2;
    const out = [];
    for (let i = 0; i < road.activeLanes; i++) {
      out.push(left + LANE_W * (i + 0.5));
    }
    return out;
  }

  // Active-lane centers at any worldY — used by traffic so each NPC can be
  // re-pinned + clamped against the road geometry at its own screen row,
  // not the player's. This keeps NPCs on-road during lane transitions.
  function laneCentersAt(road, wy) {
    const g = geometryAt(road, wy);
    const center = C.INTERNAL_WIDTH / 2;
    const w = g.activeLanes * LANE_W;
    const left = center - w / 2;
    const out = [];
    for (let i = 0; i < g.activeLanes; i++) {
      out.push(left + LANE_W * (i + 0.5));
    }
    return out;
  }

  // Visual road edges at any worldY (the white lines you see). Asphalt is
  // exactly between these. Used for clamping NPC.x.
  function edgesAt(road, wy) {
    const g = geometryAt(road, wy);
    const center = C.INTERNAL_WIDTH / 2;
    const w = g.visualLanes * LANE_W;
    return { left: center - w / 2, right: center + w / 2 };
  }

  function nearestLane(road, x) {
    const centers = laneCenters(road);
    let best = centers[0], bd = Infinity;
    for (const c of centers) {
      const d = Math.abs(c - x);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function laneWidth() { return LANE_W; }

  // Per-row rendering: each screen y maps to its own worldY, so a transition
  // appears in the distance and scrolls down toward the player at the same
  // speed as the rest of the road. The mapping is
  //   worldY(screenY) = worldOffset + (CAR.screenY - screenY)
  // (road shifts upward visually as worldOffset grows; row at the car's
  // screenY is the player's current worldOffset).
  function draw(ctx, road, worldOffset) {
    const H = C.INTERNAL_HEIGHT;
    const W = C.INTERNAL_WIDTH;
    const center = W / 2;
    const sH = C.ROAD.stripeH;
    const dash = sH + C.ROAD.stripeGap;
    const carScreenY = C.CAR.screenY;

    // Cache per-row geometry once. Cheap (linear scan over a small schedule).
    const rows = new Array(H);
    for (let y = 0; y < H; y++) {
      const wy = worldOffset + (carScreenY - y);
      rows[y] = { wy, g: geometryAt(road, wy) };
    }

    // Pre-round per-row width so asphalt and edge lines snap to the same
    // integer columns — otherwise the white edges and the dark surface drift
    // by a pixel relative to each other during a transition.
    const widths = new Array(H);
    const lefts  = new Array(H);
    for (let y = 0; y < H; y++) {
      const visW = Math.round(rows[y].g.visualLanes * LANE_W);
      widths[y] = visW;
      lefts[y]  = Math.round(center - visW / 2);
    }

    // Asphalt
    ctx.fillStyle = '#3c3c3c';
    for (let y = 0; y < H; y++) {
      ctx.fillRect(lefts[y], y, widths[y], 1);
    }

    // Outer edge lines (2 px wide, full height — drawn per row to track curve
    // of the changing width).
    ctx.fillStyle = '#e8e8e8';
    for (let y = 0; y < H; y++) {
      const left = lefts[y];
      const right = left + widths[y];
      ctx.fillRect(left, y, 2, 1);
      ctx.fillRect(right - 2, y, 2, 1);
    }

    // Dashed lane stripes. Outside the transition zone we use the segment's
    // lane count directly. Inside the zone we crossfade between the prev and
    // cur layouts (prev fading out, cur fading in) so the stripe pattern
    // morphs smoothly across the boundary instead of snapping.
    function paintStripes(yRow, lanes, fill) {
      if (lanes < 2) return;
      ctx.fillStyle = fill;
      const w = lanes * LANE_W;
      const left = center - w / 2;
      for (let l = 1; l < lanes; l++) {
        const sx = (left + LANE_W * l - 1) | 0;
        ctx.fillRect(sx, yRow, 2, 1);
      }
    }
    for (let y = 0; y < H; y++) {
      const wy = rows[y].wy;
      const phase = ((wy % dash) + dash) % dash;
      if (phase >= sH) continue;
      const g = rows[y].g;
      const inTrans = g.transitionAlpha > 0 && g.lanes !== g.prevLanes;
      if (!inTrans) {
        paintStripes(y, g.lanes, '#e8c020');
      } else {
        const t = g.transitionAlpha;
        paintStripes(y, g.prevLanes, 'rgba(232,192,32,' + (1 - t).toFixed(3) + ')');
        paintStripes(y, g.lanes,     'rgba(232,192,32,' + t.toFixed(3) + ')');
      }
    }

    // Ghost-lane indicators: orange dots centered in the appearing / closing
    // strip on each side, only inside a transition zone.
    ctx.fillStyle = '#e8a040';
    for (let y = 0; y < H; y++) {
      const g = rows[y].g;
      if (g.transitionT <= 0) continue;
      const visW = widths[y];
      const actW = g.activeLanes * LANE_W;
      if (Math.abs(visW - actW) <= 1) continue;
      const phase = ((rows[y].wy % dash) + dash) % dash;
      if (phase >= 4) continue;
      const leftEdge = lefts[y];
      const rightEdge = leftEdge + visW;
      const ghostHalf = (visW - actW) / 2;
      const lcx = (leftEdge + ghostHalf / 2) | 0;
      const rcx = (rightEdge - ghostHalf / 2) | 0;
      ctx.fillRect(lcx - 1, y, 2, 1);
      ctx.fillRect(rcx - 1, y, 2, 1);
    }
  }

  return {
    create, update, bounds, laneCenters, laneCentersAt, edgesAt,
    nearestLane, laneWidth, maxWidth, draw,
  };
})();
