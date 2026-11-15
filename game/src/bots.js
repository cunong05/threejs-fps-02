// EMBERLINE — bot brains. Each bot is a small state machine over the
// waypoint graph: it walks a lane route, holds a site, reacts to gunfire it
// hears, and engages what it can see. Aim error and a reaction delay keep
// bots fair; they miss first, then tighten up.
import { WAYPOINTS, findPath, nearestWaypoint, losBlocked, inSite, SITES, collideCircle, eyeHeight } from './map.js';
import { fireShot, spreadDir, currentSpread } from './combat.js';
import { WEAPONS } from './weapons.js';

const REACT = 0.55; // seconds before a bot that just spotted you starts firing
const SEE_RANGE = 52;
const HEAR_RANGE = 26;

// Lane assignments: which waypoint route each bot prefers, by index.
const ROUTES = {
  A: [16, 1, 2, 3, 4, 9, 13],
  MID: [16, 17, 8, 12, 13],
  B: [16, 5, 6, 7, 11, 14],
};

export function makeBot(f, role, lane) {
  f.bot = {
    role, // 'attack' | 'defend'
    lane,
    route: ROUTES[lane].slice(),
    routeIdx: 0,
    path: [],
    pathIdx: 0,
    holdNode: lane === 'A' ? 13 : lane === 'B' ? 14 : 12,
    state: 'move', // move | hold | engage | plant | defuse | investigate | dead
    target: null,
    seenAt: -9,
    targetPos: { x: 0, z: 0 },
    reactAt: 0,
    burstLeft: 0,
    nextShot: 0,
    aimErr: 0.05,
    lastThink: 0,
    investigate: null,
    strafeDir: 1,
    strafeUntil: 0,
    holdUntil: 0,
    stepPhase: Math.random() * 6,
  };
  return f.bot;
}

// Pick the nearest living enemy the bot can actually see.
function visibleEnemy(state, fighters, f, now) {
  const bot = f.bot;
  const eyeY = eyeHeight(f.crouched);
  let best = null, bestD = Infinity;
  for (const e of fighters) {
    if (!e.alive || e.team === f.team) continue;
    const dx = e.pos.x - f.pos.x, dz = e.pos.z - f.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > SEE_RANGE || d >= bestD) continue;
    // rough field of view: 115 degrees
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    if ((dx * fx + dz * fz) / d < -0.4 && d > 3) continue;
    if (losBlocked(f.pos.x, f.pos.z, e.pos.x, e.pos.z)) continue;
    // mist grenades block sight: segment vs smoke circle
    let smoked = false;
    for (const s of state.smokes) {
      const dx = e.pos.x - f.pos.x, dz = e.pos.z - f.pos.z;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((s.x - f.pos.x) * dx + (s.z - f.pos.z) * dz) / len2));
      const cx = f.pos.x + dx * t - s.x, cz = f.pos.z + dz * t - s.z;
      if (cx * cx + cz * cz < s.r * s.r) { smoked = true; break; }
    }
    if (smoked) continue;
    // crouched enemies behind low cover are harder to spot up close
    if (e.crouched && d > 18 && Math.random() < 0.4) continue;
    best = e; bestD = d;
  }
  if (best) {
    bot.seenAt = now;
    bot.targetPos.x = best.pos.x; bot.targetPos.z = best.pos.z;
    best.spottedAt = now;
  }
  return best;
}

function nearestEnemy(fighters, f) {
  let best = null, bd = Infinity;
  for (const e of fighters) {
    if (!e.alive || e.team === f.team) continue;
    const d = (e.pos.x - f.pos.x) ** 2 + (e.pos.z - f.pos.z) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// A gunshot is a noise event: bots within earshot turn to investigate.
export function hearShot(state, fighters, shooter, x, z) {
  for (const f of fighters) {
    if (!f.alive || !f.bot || f === shooter) continue;
    const d = Math.hypot(f.pos.x - x, f.pos.z - z);
    if (d < HEAR_RANGE) {
      const b = f.bot;
      if (b.state === 'hold' || b.state === 'move') {
        b.investigate = { x, z, until: state.time + 4 };
        if (b.state === 'hold') b.state = 'investigate';
      }
    }
  }
  void state;
}

function steerTo(f, tx, tz, dt, speedMul) {
  const dx = tx - f.pos.x, dz = tz - f.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return true;
  const want = Math.atan2(-dx, -dz);
  // turn toward the target, capped so bots visibly rotate
  let diff = want - f.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  f.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
  const speed = 3.4 * (speedMul || 1) * (f.crouched ? 0.55 : 1);
  f.pos.x += -Math.sin(f.yaw) * speed * dt;
  f.pos.z += -Math.cos(f.yaw) * speed * dt;
  f.speed = speed;
  collideCircle(f.pos, 0.42);
  return d < 0.6;
}

function botShoot(state, fighters, f, now, dirOut) {
  const b = f.bot;
  const w = WEAPONS[f.weapon];
  if (f.reloading > 0) return;
  if (f.mag <= 0) {
    f.reloading = w.reload;
    return;
  }
  if (now < b.nextShot) return;
  if (b.burstLeft <= 0) {
    b.burstLeft = 3 + Math.floor(Math.random() * 4);
    b.nextShot = now + 0.25 + Math.random() * 0.5;
    return;
  }
  // aim at the target's chest, plus an error that shrinks while engaging
  const t = b.target;
  if (!t || !t.alive) return;
  const ty = t.crouched ? 1.0 : 1.3;
  const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z;
  const dist = Math.hypot(dx, dz);
  const baseYaw = Math.atan2(-dx, -dz);
  const basePitch = Math.atan2(ty - eyeHeight(f.crouched), dist);
  const err = b.aimErr + (dist / SEE_RANGE) * 0.03 + currentSpread(f);
  const dir = spreadDir(baseYaw, basePitch, err, dirOut);
  const origin = { x: f.pos.x, y: eyeHeight(f.crouched), z: f.pos.z };
  const res = fireShot(state, fighters, f, dir, origin);
  state.tracers.push({ from: origin, to: { x: origin.x + dir.x * res.dist, y: origin.y + dir.y * res.dist, z: origin.z + dir.z * res.dist }, born: now, life: 0.06, color: w.tracer });
  f.mag -= 1;
  f.lastShot = now;
  b.burstLeft -= 1;
  b.nextShot = now + w.rate + Math.random() * 0.03;
  if (res.hit && res.target.isPlayer) state.lastDamageAt = now;
  if (Math.random() < 0.05) hearShot(state, fighters, f, f.pos.x, f.pos.z);
}

// One fixed-step tick of one bot.
export function updateBot(state, fighters, f, dt, dirOut) {
  const b = f.bot;
  const now = state.time;
  if (!f.alive) { b.state = 'dead'; f.speed = 0; return; }
  if (f.reloading > 0) f.reloading -= dt;

  // think at 8 Hz, not every step
  if (now - b.lastThink > 0.125) {
    b.lastThink = now;
    const seen = visibleEnemy(state, fighters, f, now);
    if (seen) {
      if (b.target !== seen) { b.reactAt = now + REACT * (0.7 + Math.random() * 0.6); b.aimErr = 0.06; }
      b.target = seen;
    } else if (b.target && now - b.seenAt > 1.6) {
      b.target = null;
    }
    if (b.target) b.aimErr = Math.max(0.008, b.aimErr * 0.82);
  }

  // planted spike changes everyone's job
  if (state.plant.state === 'planted') {
    if (f.team === state.attackers) {
      b.holdNode = state.plant.site === 'A' ? 13 : 14;
      if (b.state !== 'engage') b.state = 'hold';
    } else {
      // defenders rush the site to defuse; only re-path when the target
      // site changes, or the bot restarts its route every tick and stalls
      const site = SITES[state.plant.site];
      if (inSite(site, f.pos.x, f.pos.z)) {
        b.state = 'defuse';
      } else {
        b.state = 'move';
        if (b.defuseTarget !== state.plant.site || !b.path.length) {
          b.path = findPath(nearestWaypoint(f.pos.x, f.pos.z), state.plant.site === 'A' ? 13 : 14);
          b.pathIdx = 0;
          b.defuseTarget = state.plant.site;
        }
      }
    }
  }

  // engage overrides movement
  if (b.target && b.target.alive && now >= b.reactAt) {
    b.state = 'engage';
    const t = b.target;
    const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    // face the target; strafe sideways while shooting
    if (now > b.strafeUntil) { b.strafeDir = Math.random() < 0.5 ? -1 : 1; b.strafeUntil = now + 0.7 + Math.random() * 0.8; }
    f.yaw = Math.atan2(-dx, -dz);
    if (dist > 14) {
      f.pos.x += -Math.sin(f.yaw) * 1.6 * dt;
      f.pos.z += -Math.cos(f.yaw) * 1.6 * dt;
      collideCircle(f.pos, 0.42);
      f.speed = 1.6;
    } else {
      const sx = Math.cos(f.yaw) * b.strafeDir, sz = -Math.sin(f.yaw) * b.strafeDir;
      f.pos.x += sx * 1.4 * dt; f.pos.z += sz * 1.4 * dt;
      collideCircle(f.pos, 0.42);
      f.speed = 1.4;
    }
    // crouch occasionally at range for a steadier shot
    f.crouched = dist > 20 && Math.random() < 0.02 ? true : (dist < 12 ? false : f.crouched);
    botShoot(state, fighters, f, now, dirOut);
    return;
  }

  if (b.state === 'engage' && !b.target) b.state = b.role === 'attack' ? 'move' : 'hold';

  if (b.state === 'defuse') {
    f.defusing += dt;
    if (f.defusing > 0) state.plant.defuseProgress = f.defusing;
    return;
  }

  if (b.state === 'plant') {
    f.planting += dt;
    return;
  }

  if (b.state === 'investigate' && b.investigate) {
    if (now > b.investigate.until) { b.state = 'hold'; b.investigate = null; }
    else if (steerTo(f, b.investigate.x, b.investigate.z, dt, 1.1)) { b.state = 'hold'; b.investigate = null; }
    return;
  }

  if (b.state === 'hold') {
    f.speed = 0;
    // hold the angle: slowly scan the lane
    f.yaw += Math.sin(now * 0.5 + b.stepPhase) * 0.25 * dt;
    // spike carrier plants when the site is clear of enemies
    if (f.hasSpike && (inSite(SITES.A, f.pos.x, f.pos.z) || inSite(SITES.B, f.pos.x, f.pos.z))) {
      const near = nearestEnemy(fighters, f);
      const nd = near ? Math.hypot(near.pos.x - f.pos.x, near.pos.z - f.pos.z) : 999;
      if (nd > 12) b.state = 'plant';
    }
    return;
  }

  // move: follow the current path, else the lane route
  if (b.path.length && b.pathIdx < b.path.length) {
    const node = WAYPOINTS[b.path[b.pathIdx]];
    if (steerTo(f, node[1], node[2], dt, 1)) {
      b.pathIdx += 1;
      if (b.pathIdx >= b.path.length) {
        b.path = [];
        b.state = b.role === 'attack' ? 'hold' : 'hold';
      }
    }
    return;
  }
  if (b.routeIdx < b.route.length) {
    const nodeId = b.route[b.routeIdx];
    const node = WAYPOINTS[nodeId];
    if (steerTo(f, node[1], node[2], dt, 1)) b.routeIdx += 1;
    return;
  }
  b.state = 'hold';
}

// Assign a fresh route for the next round.
export function assignRoute(f, round) {
  const b = f.bot;
  const lanes = ['A', 'MID', 'B'];
  b.lane = lanes[(round + f.id) % 3];
  b.route = ROUTES[b.lane].slice();
  b.routeIdx = 0;
  b.path = [];
  b.holdNode = b.lane === 'A' ? 13 : b.lane === 'B' ? 14 : 12;
  b.state = 'move';
  b.target = null;
  b.investigate = null;
  f.planting = 0; f.defusing = 0;
  if (b.role === 'defend') {
    // defenders start east: pathfind from their spawn to the hold node
    b.route = [];
    b.path = findPath(nearestWaypoint(f.pos.x, f.pos.z), b.holdNode);
    b.pathIdx = 0;
  }
}
