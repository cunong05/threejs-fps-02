// EMBERLINE — hitscan combat. Shots are resolved analytically against the
// map's AABBs and each fighter's three hitboxes (head / torso / legs), so a
// headshot is a geometry fact, not a raycast against a mesh. No allocation in
// the hot path: the ray-box test works on plain numbers.
import { COLLIDERS } from './map.js';
import { WEAPONS, applyDamage } from './weapons.js';

// Ray vs axis-aligned box. Returns the entry distance, or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let t0 = 0, t1 = Infinity;
  // x slab
  if (Math.abs(dx) < 1e-9) { if (ox < minX || ox > maxX) return Infinity; }
  else {
    let ta = (minX - ox) / dx, tb = (maxX - ox) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < minY || oy > maxY) return Infinity; }
  else {
    let ta = (minY - oy) / dy, tb = (maxY - oy) / dy;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < minZ || oz > maxZ) return Infinity; }
  else {
    let ta = (minZ - oz) / dz, tb = (maxZ - oz) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

// Nearest wall distance along a ray (0..range), Infinity when it escapes.
export function wallDistance(ox, oy, oz, dx, dy, dz, range) {
  let best = Infinity;
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    const t = rayBox(ox, oy, oz, dx, dy, dz, c.x0, 0, c.z0, c.x1, c.h, c.z1);
    if (t < best && t <= range) best = t;
  }
  return best;
}

// Hitboxes for one fighter, in world space. Head is a small box on top;
// crouching lowers every box by 0.45.
function hitboxOf(f) {
  const crouch = f.crouched ? 0.45 : 0;
  const top = 1.78 - crouch;
  return [
    { zone: 'head', minX: f.pos.x - 0.15, maxX: f.pos.x + 0.15, minY: top - 0.30, maxY: top, minZ: f.pos.z - 0.15, maxZ: f.pos.z + 0.15 },
    { zone: 'torso', minX: f.pos.x - 0.27, maxX: f.pos.x + 0.27, minY: 0.86 - crouch, maxY: top - 0.30, minZ: f.pos.z - 0.21, maxZ: f.pos.z + 0.21 },
    { zone: 'leg', minX: f.pos.x - 0.24, maxX: f.pos.x + 0.24, minY: 0, maxY: 0.86 - crouch, minZ: f.pos.z - 0.2, maxZ: f.pos.z + 0.2 },
  ];
}

// Fire one bullet from `shooter` along `dir` (unit vector, already spread).
// Returns { hit, target, zone, dist, wallDist }. Applies damage and the
// killfeed entry; the caller handles sound, tracer and recoil.
export function fireShot(state, fighters, shooter, dir, origin) {
  const w = WEAPONS[shooter.weapon];
  const wallT = wallDistance(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.range);
  let bestT = wallT, bestF = null, bestZone = null;
  for (const f of fighters) {
    if (f === shooter || !f.alive) continue;
    if (f.team === shooter.team) continue;
    const boxes = hitboxOf(f);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const t = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
        b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      if (t < bestT) { bestT = t; bestF = f; bestZone = b.zone; }
    }
  }
  const result = { hit: !!bestF, target: bestF, zone: bestZone, dist: Number.isFinite(bestT) ? bestT : w.range, wallDist: wallT };
  if (bestF) {
    const mul = bestZone === 'head' ? w.headMul : bestZone === 'leg' ? w.legMul : 1;
    // applyDamage multiplies by its own zone table, so pass the weapon's
    // zone multiplier in and a neutral zone to avoid double-counting.
    applyDamage(bestF, w.damage * mul, 'torso');
    if (!bestF.alive) {
      bestF.deaths += 1;
      shooter.kills += 1;
      bestF.deadAt = state.time;
      state.feed.unshift({ text: `${shooter.name} ✕ ${bestF.name}${bestZone === 'head' ? ' (headshot)' : ''}`, t: state.time });
      if (state.feed.length > 5) state.feed.pop();
      if (shooter.isPlayer) state.stats.kills += 1;
      if (bestF.isPlayer) state.stats.deaths += 1;
      // the spike drops where its carrier falls
      if (bestF.hasSpike) {
        bestF.hasSpike = false;
        state.plant.state = 'dropped';
        state.plant.droppedAt = { x: bestF.pos.x, z: bestF.pos.z };
      }
    }
  }
  return result;
}

// Direction from a shooter, with spread. `spread` is radians; the sample is
// a uniform disc so sustained fire visibly opens the group.
export function spreadDir(yaw, pitch, spread, out) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * spread;
  const sy = yaw + Math.cos(a) * r;
  const sp = pitch + Math.sin(a) * r;
  const cp = Math.cos(sp);
  out.x = -Math.sin(sy) * cp;
  out.y = Math.sin(sp);
  out.z = -Math.cos(sy) * cp;
  return out;
}

// Current spread for a fighter: base + movement + air + bloom.
export function currentSpread(f) {
  const w = WEAPONS[f.weapon];
  let s = w.spread + f.spreadBloom;
  if (!f.onGround) s += w.airSpread;
  else if (f.speed > 0.6) s += w.moveSpread * Math.min(1, f.speed / 5);
  if (f.crouched) s *= 0.6;
  return s;
}
