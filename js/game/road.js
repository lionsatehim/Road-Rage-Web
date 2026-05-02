// Road geometry with one-sided lane changes.
//
// Each segment carries absolute leftEdge / rightEdge (in screen X). When a
// transition happens, exactly one side moves — the other stays put. That
// matches how real highways add or drop a lane: the outer edge juts out
// (or in) on one side; the lanes that survive don't shift sideways.
//
// Schedule rules:
//   - first segment is centered on screen
//   - each transition rolls a delta in {-1, 0, +1}, weighted toward 0 so we
//     get long flat stretches; clamped to [min, max]
//   - if the road's center is off-screen-center, the side is forced so the
//     change pulls the center back toward 0 (drift bounded to ±LANE_W/2)
//   - if centered, side is random
//
// Visual:
//   - asphalt + edge lines per row, sourced from geometryAt(wy)
//   - surviving lane stripes are dead-straight through the transition zone
//     (no V-shapes, no crossfade) since their X positions don't change
//   - the appearing / closing lane has a dotted "warning" stripe at the
//     boundary X through the transition zone — visually the line peels
//     off the wall (opening) or gets absorbed by the wall (closing)
window.RR = window.RR || {};

RR.Road = (function () {
  const C = RR.Config;
  const LANE_W = 28;

  function smoothstep(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  // ---- Schedule ----

  function buildSchedule(mapType, totalDistance) {
    const cfg = C.MAPS[mapType] || C.MAPS.suburb;
    const lanesCfg = (cfg && cfg.lanes) ||
      { min: 3, max: 3, segment: [totalDistance, totalDistance], transition: 80 };
    const minL = lanesCfg.min;
    const maxL = lanesCfg.max;
    const [segLo, segHi] = lanesCfg.segment;
    const screenC = C.INTERNAL_WIDTH / 2;

    const segs = [];
    let pos = 0;

    // First segment: centered on screen.
    let curLanes = minL + Math.floor(Math.random() * (maxL - minL + 1));
    let leftEdge = screenC - curLanes * LANE_W / 2;
    let rightEdge = leftEdge + curLanes * LANE_W;
    let segLen = segLo + Math.random() * (segHi - segLo);
    segs.push({
      start: pos, end: pos + segLen,
      lanes: curLanes, leftEdge, rightEdge,
      changeSide: null,
    });
    pos += segLen;

    // Subsequent segments. Roll delta + side per the centered-bias rule.
    while (pos < totalDistance + 400) {
      // Δ weighted: 60% no change, 20% +1, 20% −1. Long flat stretches by
      // default; transitions happen but aren't constant.
      const r = Math.random();
      let delta = (r < 0.6) ? 0 : (r < 0.8 ? 1 : -1);
      let nextLanes = curLanes + delta;
      // If the roll would push us out of [min, max], stay flat. Avoids
      // biasing the schedule toward bouncing off the bounds.
      if (nextLanes < minL || nextLanes > maxL) {
        delta = 0;
        nextLanes = curLanes;
      }

      let side = null;
      if (delta !== 0) {
        const drift = (leftEdge + rightEdge) / 2 - screenC;
        if (drift > 0.5) {
          // Biased right → must move center left.
          side = (delta > 0) ? 'left' : 'right';
        } else if (drift < -0.5) {
          // Biased left → must move center right.
          side = (delta > 0) ? 'right' : 'left';
        } else {
          side = (Math.random() < 0.5) ? 'left' : 'right';
        }
      }

      // Apply edge change.
      let newLeft = leftEdge, newRight = rightEdge;
      if (delta > 0) {
        if (side === 'left')  newLeft  = leftEdge  - LANE_W;
        else                   newRight = rightEdge + LANE_W;
      } else if (delta < 0) {
        if (side === 'left')  newLeft  = leftEdge  + LANE_W;
        else                   newRight = rightEdge - LANE_W;
      }

      curLanes  = nextLanes;
      leftEdge  = newLeft;
      rightEdge = newRight;

      segLen = segLo + Math.random() * (segHi - segLo);
      segs.push({
        start: pos, end: pos + segLen,
        lanes: curLanes, leftEdge, rightEdge,
        changeSide: side,
      });
      pos += segLen;
    }
    return segs;
  }

  function create(mapType, totalDistance) {
    const cfg = C.MAPS[mapType] || C.MAPS.suburb;
    const transitionLen = (cfg.lanes && cfg.lanes.transition) || 80;
    const road = {
      schedule: buildSchedule(mapType, totalDistance),
      transitionLen,
      // Live values populated by update() at the player's worldY.
      lanes: 3, activeLanes: 3,
      leftEdge: 0, rightEdge: 0, width: 0,
      transitionT: 0, transitionAlpha: 0,
      changeSide: null,
      specialStripeX: null,
      worldOffset: 0,
    };
    update(road, 0);
    return road;
  }

  // ---- Geometry at a worldY ----

  // Returns the geometric state of the road at any worldY:
  //   leftEdge / rightEdge — actual edges (lerped through transition)
  //   lanes / prevLanes    — segment counts on each side of the active boundary
  //   activeLanes          — min(prev, next); the surviving lanes
  //   transitionAlpha      — 0..1 raw progress through the zone (0.5 at boundary)
  //   transitionT          — peaked 0..1..0
  //   changeSide           — 'left' | 'right' | null inside transition
  //   isOpening / isClosing- whether activeLanes is gaining / losing
  //   specialStripeX       — X of the closing/opening lane's boundary
  //                          stripe (the warning marker), or null
  //
  // The transition zone for a boundary spans transHalf on EACH side of it,
  // so a row near the end of segment N is just as much "in transition" as
  // a row near the start of segment N+1. We detect both halves explicitly.
  // How far before a transition we draw the dotted warning stripe. The
  // edges only start lerping at transHalf, but the warning marker extends
  // back into the prev segment so the driver sees it coming earlier.
  const WARN_AHEAD = 240;

  function geometryAt(road, wy) {
    const sched = road.schedule;
    const transHalf = road.transitionLen / 2;

    // Find the segment containing wy (here.end > wy, smallest such).
    let segIdx = sched.length - 1;
    for (let i = 0; i < sched.length; i++) {
      if (wy < sched[i].end) { segIdx = i; break; }
    }
    const here = sched[segIdx];

    // Decide which boundary affects this row:
    //   - latter half of (segIdx-1 → here): wy < here.start + transHalf
    //   - earlier half + warning lead-in of (here → segIdx+1):
    //     wy >= here.end - transHalf - warnAhead, where warnAhead only
    //     applies for closing transitions (opening doesn't get a lead-in)
    // Segments are >> transitionLen long, so both halves can't be true at once.
    let prevSeg = here, nextSeg = here, distFromBoundary = 0;
    let withinZone = false;   // inside the actual edge-lerp zone (transHalf each side)
    let withinWarn = false;   // inside the dotted-warning extent (lead-in + zone)
    if (segIdx > 0 && wy < here.start + transHalf) {
      prevSeg = sched[segIdx - 1];
      nextSeg = here;
      distFromBoundary = wy - here.start;
      withinZone = true;
      withinWarn = true;
    } else if (segIdx + 1 < sched.length) {
      const upcoming = sched[segIdx + 1];
      const distAhead = here.end - wy;   // positive when boundary is ahead
      const closingAhead = upcoming.lanes < here.lanes;
      const warnDist = closingAhead ? WARN_AHEAD : 0;
      if (distAhead <= transHalf + warnDist && distAhead > -transHalf) {
        prevSeg = here;
        nextSeg = upcoming;
        distFromBoundary = wy - here.end;   // negative through earlier half
        withinZone = (distAhead <= transHalf);
        withinWarn = true;
      }
    }
    const inTransition = withinZone && prevSeg.lanes !== nextSeg.lanes;
    const inWarning    = withinWarn && prevSeg.lanes !== nextSeg.lanes;

    let leftEdge   = here.leftEdge;
    let rightEdge  = here.rightEdge;
    let activeLanes = here.lanes;
    let transitionT = 0;
    let transitionAlpha = 0;
    let changeSide = null;
    let isOpening = false, isClosing = false;
    let specialStripeX = null;

    if (inTransition) {
      const t = (distFromBoundary + transHalf) / road.transitionLen;
      const eased = smoothstep(t);
      transitionAlpha = t;
      transitionT = 1 - 2 * Math.abs(t - 0.5);
      changeSide = nextSeg.changeSide;
      isOpening  = nextSeg.lanes > prevSeg.lanes;
      isClosing  = nextSeg.lanes < prevSeg.lanes;
      activeLanes = Math.min(prevSeg.lanes, nextSeg.lanes);

      if (changeSide === 'left') {
        leftEdge  = prevSeg.leftEdge + (nextSeg.leftEdge - prevSeg.leftEdge) * eased;
        rightEdge = nextSeg.rightEdge; // unchanged through the zone
        // Warning stripe at the inner edge of the changing zone.
        // Closing: the cur (smaller) road's leftEdge — the wall is moving in
        //   to absorb this stripe. Opening: the prev (smaller) leftEdge —
        //   the wall is peeling off this stripe.
        specialStripeX = isClosing ? nextSeg.leftEdge : prevSeg.leftEdge;
      } else if (changeSide === 'right') {
        leftEdge  = nextSeg.leftEdge;
        rightEdge = prevSeg.rightEdge + (nextSeg.rightEdge - prevSeg.rightEdge) * eased;
        specialStripeX = isClosing ? nextSeg.rightEdge : prevSeg.rightEdge;
      }
    } else if (inWarning) {
      // Lead-in to a closing transition. Edges stay at prev's values, but we
      // mark the future wall position with the dotted warning stripe so the
      // driver has time to vacate the closing lane.
      changeSide = nextSeg.changeSide;
      isClosing  = nextSeg.lanes < prevSeg.lanes;
      isOpening  = nextSeg.lanes > prevSeg.lanes;
      if (changeSide === 'left'  && isClosing) specialStripeX = nextSeg.leftEdge;
      if (changeSide === 'right' && isClosing) specialStripeX = nextSeg.rightEdge;
    }

    // Suppress the dotted stripe when it's about to coincide with a wall
    // (closing) or has just peeled off one (opening) — keeps the marker
    // visually distinct from the white edge line.
    if (specialStripeX !== null) {
      const distToLeft  = specialStripeX - leftEdge;
      const distToRight = rightEdge - specialStripeX;
      if (Math.min(distToLeft, distToRight) < 4) specialStripeX = null;
    }

    return {
      leftEdge, rightEdge,
      lanes: nextSeg.lanes, prevLanes: prevSeg.lanes,
      activeLanes,
      transitionT, transitionAlpha,
      changeSide, isOpening, isClosing,
      specialStripeX,
    };
  }

  // ---- Public helpers ----

  function maxWidth(road) {
    let m = 0;
    for (const seg of road.schedule) {
      const w = seg.rightEdge - seg.leftEdge;
      if (w > m) m = w;
    }
    return m;
  }

  // Worst-case absolute extents — the leftmost left edge and rightmost right
  // edge across the whole schedule. Used by map deco placement to keep set
  // pieces clear of every segment, including drifted ones.
  function extents(road) {
    let minLeft = Infinity, maxRight = -Infinity;
    for (const seg of road.schedule) {
      if (seg.leftEdge  < minLeft)  minLeft  = seg.leftEdge;
      if (seg.rightEdge > maxRight) maxRight = seg.rightEdge;
    }
    return { minLeft, maxRight };
  }

  function update(road, worldOffset) {
    road.worldOffset = worldOffset;
    const g = geometryAt(road, worldOffset);
    road.lanes = g.lanes;
    road.activeLanes = g.activeLanes;
    road.leftEdge = g.leftEdge;
    road.rightEdge = g.rightEdge;
    road.width = g.rightEdge - g.leftEdge;
    road.transitionT = g.transitionT;
    road.transitionAlpha = g.transitionAlpha;
    road.changeSide = g.changeSide;
    road.specialStripeX = g.specialStripeX;
  }

  function bounds(road) {
    return { x: road.leftEdge, width: road.width, lanes: road.activeLanes };
  }

  // Active (surviving) lane centers. Anchored to the FIXED side so the
  // surviving lanes' X positions don't shift during a transition.
  function laneCentersAt(road, wy) {
    const g = geometryAt(road, wy);
    const out = [];
    if (g.changeSide === 'left') {
      // Right side fixed; count lanes from the right.
      for (let i = 0; i < g.activeLanes; i++) {
        out.push(g.rightEdge - LANE_W * (g.activeLanes - i - 0.5));
      }
    } else {
      // Right-side change OR no transition: anchor at left edge.
      for (let i = 0; i < g.activeLanes; i++) {
        out.push(g.leftEdge + LANE_W * (i + 0.5));
      }
    }
    return out;
  }

  function laneCenters(road) {
    return laneCentersAt(road, road.worldOffset);
  }

  function edgesAt(road, wy) {
    const g = geometryAt(road, wy);
    return { left: g.leftEdge, right: g.rightEdge };
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

  // ---- Drawing ----

  function draw(ctx, road, worldOffset) {
    const H = C.INTERNAL_HEIGHT;
    const sH = C.ROAD.stripeH;
    const dash = sH + C.ROAD.stripeGap;
    const carScreenY = C.CAR.screenY;

    // Cache per-row geometry once.
    const rows = new Array(H);
    for (let y = 0; y < H; y++) {
      const wy = worldOffset + (carScreenY - y);
      rows[y] = { wy, g: geometryAt(road, wy) };
    }

    // Pre-round edges per row so asphalt + edge lines snap to the same cols.
    const lefts = new Array(H);
    const widths = new Array(H);
    for (let y = 0; y < H; y++) {
      const left  = Math.round(rows[y].g.leftEdge);
      const right = Math.round(rows[y].g.rightEdge);
      lefts[y]  = left;
      widths[y] = right - left;
    }

    // Asphalt
    ctx.fillStyle = '#3c3c3c';
    for (let y = 0; y < H; y++) {
      ctx.fillRect(lefts[y], y, widths[y], 1);
    }

    // Outer edge lines (white, 2 px wide)
    ctx.fillStyle = '#e8e8e8';
    for (let y = 0; y < H; y++) {
      const left = lefts[y];
      const right = left + widths[y];
      ctx.fillRect(left, y, 2, 1);
      ctx.fillRect(right - 2, y, 2, 1);
    }

    // Lane stripes between active (surviving) lanes — straight dashed yellow.
    ctx.fillStyle = '#e8c020';
    for (let y = 0; y < H; y++) {
      const wy = rows[y].wy;
      const phase = ((wy % dash) + dash) % dash;
      if (phase >= sH) continue;
      const g = rows[y].g;
      if (g.activeLanes < 2) continue;

      // Surviving section anchor: same logic as laneCentersAt — left edge
      // when the right side is changing (or no change), right-anchored
      // when the left side is changing.
      let anchorX, dir;
      if (g.changeSide === 'left') {
        anchorX = Math.round(g.rightEdge);
        dir = -1;
      } else {
        anchorX = Math.round(g.leftEdge);
        dir = 1;
      }
      for (let l = 1; l < g.activeLanes; l++) {
        const sx = anchorX + dir * LANE_W * l - 1;
        ctx.fillRect(sx, y, 2, 1);
      }
    }

    // Warning stripe at the closing/opening lane boundary — sparse dots
    // (2 px on / 7 px off) so it reads as a "warning" pattern, distinct
    // from the regular dashed lane stripes.
    ctx.fillStyle = '#ffd040';
    const dotPeriod = 9, dotOn = 2;
    for (let y = 0; y < H; y++) {
      const g = rows[y].g;
      if (g.specialStripeX === null) continue;
      const wy = rows[y].wy;
      const dotPhase = ((wy % dotPeriod) + dotPeriod) % dotPeriod;
      if (dotPhase >= dotOn) continue;
      const sx = Math.round(g.specialStripeX) - 1;
      ctx.fillRect(sx, y, 2, 1);
    }
  }

  return {
    create, update, bounds, laneCenters, laneCentersAt, edgesAt,
    nearestLane, laneWidth, maxWidth, extents, draw,
  };
})();
