// Player car physics: forward speed with accel/brake/idle decel,
// lateral velocity with exponential approach to a target (slight inertia).
// On a hard crash the car enters a "stunned" state — frozen, no input — for
// a fixed reset period set by the traffic module.
window.RR = window.RR || {};

RR.Car = (function () {
  const C = RR.Config;

  function create() {
    return {
      x: C.INTERNAL_WIDTH / 2,
      y: C.CAR.screenY,
      speed: 0,
      lateralVel: 0,
      stunnedTimer: 0,
      braking: false,
    };
  }

  function clampToRoad(car, extra, road) {
    const cfg = C.CAR;
    const slack = extra || 0;
    const baseLeft  = road ? road.leftEdge  : C.ROAD.x;
    const baseRight = road ? road.rightEdge : C.ROAD.x + C.ROAD.width;
    const roadLeft  = baseLeft  + 2 - slack;
    const roadRight = baseRight - 2 + slack;
    const halfW = cfg.width / 2;
    if (car.x < roadLeft + halfW) {
      car.x = roadLeft + halfW;
      if (car.lateralVel < 0) car.lateralVel = 0;
    }
    if (car.x > roadRight - halfW) {
      car.x = roadRight - halfW;
      if (car.lateralVel > 0) car.lateralVel = 0;
    }
  }

  function update(car, dt, input, mods, road) {
    const cfg = C.CAR;
    const speedMul = (mods && mods.speedBoost) || 1;
    const steerMul = (mods && mods.steerBoost) || 1;
    const accelMul = (mods && mods.accelBoost) || 1;
    let   maxSpeed       = cfg.maxSpeed * speedMul;
    if (mods && mods.maxSpeedAbs) maxSpeed = Math.min(maxSpeed, mods.maxSpeedAbs);
    const lateralMax     = cfg.lateralMaxSpeed * steerMul;
    const lateralAccel   = cfg.lateralAccel * steerMul;

    car.braking = !!input.brake && car.speed > 0;

    // Stunned: frozen, no input.
    if (car.stunnedTimer > 0) {
      car.stunnedTimer -= dt;
      car.speed = 0;
      car.lateralVel = 0;
      car.braking = false;
      if (car.stunnedTimer < 0) car.stunnedTimer = 0;
      return;
    }

    // Forward speed
    if (input.accel) {
      car.speed += cfg.accel * accelMul * dt;
    } else if (!input.brake) {
      car.speed -= cfg.idleDecel * dt;
    }
    if (input.brake) car.speed -= cfg.brake * dt;
    if (car.speed < 0) car.speed = 0;
    if (car.speed > maxSpeed) car.speed = maxSpeed;

    // Lateral inertia
    const target = input.steer * lateralMax;
    const k = 1 - Math.exp(-lateralAccel * dt);
    car.lateralVel += (target - car.lateralVel) * k;
    car.x += car.lateralVel * dt;

    clampToRoad(car, (mods && mods.shoulderExtra) || 0, road);
  }

  return { create, update };
})();
