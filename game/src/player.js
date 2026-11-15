// EMBERLINE — the human player: pointer-look, WASD with acceleration and
// friction, crouch, jump, collision against the map, and the trigger.
import { collideCircle, eyeHeight } from './map.js';
import { fireShot, spreadDir, currentSpread } from './combat.js';
import { WEAPONS } from './weapons.js';
import { hearShot } from './bots.js';
import { sfx } from './audio.js';

export const WALK_SPEED = 5.2;
export const CROUCH_SPEED = 2.6;
const ACCEL = 42;
const FRICTION = 11;
const GRAVITY = 22;
const JUMP_VEL = 7.2;
const RADIUS = 0.42;

// Reused scratch vectors so the hot loop allocates nothing.
const DIR = { x: 0, y: 0, z: 0 };
const EYE = { x: 0, y: 0, z: 0 };

export function createInput() {
  return {
    fwd: false, back: false, left: false, right: false,
    crouch: false, jump: false,
    fire: false, firePressed: false,
    reload: false, grenade: false, buy: false, plant: false,
    mouseDX: 0, mouseDY: 0,
  };
}

export function applyLook(player, input, dt) {
  const sens = 0.0023;
  player.yaw -= input.mouseDX * sens;
  player.pitch -= input.mouseDY * sens;
  const lim = 1.52;
  if (player.pitch > lim) player.pitch = lim;
  if (player.pitch < -lim) player.pitch = -lim;
  input.mouseDX = 0;
  input.mouseDY = 0;
}

// Fixed-step movement: accelerate toward the wish direction, friction when
// idle, gravity + jump, then resolve against the map's solids.
export function stepPlayer(state, player, input, dt) {
  if (!player.alive) return;
  const crouched = input.crouch;
  player.crouched = crouched;
  const maxSpeed = crouched ? CROUCH_SPEED : WALK_SPEED;
  let wx = 0, wz = 0;
  if (input.fwd) { wx += -Math.sin(player.yaw); wz += -Math.cos(player.yaw); }
  if (input.back) { wx += Math.sin(player.yaw); wz += Math.cos(player.yaw); }
  if (input.left) { wx += -Math.cos(player.yaw); wz += Math.sin(player.yaw); }
  if (input.right) { wx += Math.cos(player.yaw); wz += -Math.sin(player.yaw); }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  player.vel.x += wx * ACCEL * dt;
  player.vel.z += wz * ACCEL * dt;
  // friction only when no input, so stopping takes a beat (tactical feel)
  if (wl === 0) {
    const f = Math.max(0, 1 - FRICTION * dt);
    player.vel.x *= f; player.vel.z *= f;
    if (Math.hypot(player.vel.x, player.vel.z) < 0.05) { player.vel.x = 0; player.vel.z = 0; }
  }
  const sp = Math.hypot(player.vel.x, player.vel.z);
  if (sp > maxSpeed) {
    player.vel.x *= maxSpeed / sp;
    player.vel.z *= maxSpeed / sp;
  }
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  collideCircle(player.pos, RADIUS);
  player.speed = Math.hypot(player.vel.x, player.vel.z);

  // vertical: jump + gravity, flat ground at y = 0
  if (player.onGround && input.jump && !crouched) {
    player.vel.y = JUMP_VEL;
    player.onGround = false;
  }
  if (!player.onGround) {
    player.vel.y -= GRAVITY * dt;
    player.pos.y += player.vel.y * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.vel.y = 0; player.onGround = true; }
  }

  // recoil recovery: bloom decays, kick eases off
  player.spreadBloom = Math.max(0, player.spreadBloom - dt * 0.03);
  player.recoil = Math.max(0, player.recoil - dt * 0.06);
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      const w = WEAPONS[player.weapon];
      const take = Math.min(w.mag - player.mag, player.reserve);
      player.mag += take;
      player.reserve -= take;
      player.reloading = 0;
    }
  }
}

// Fire handling, called from the fixed step. Returns true when a shot went out.
export function stepTrigger(state, fighters, player, input, now) {
  if (!player.alive || player.reloading > 0) return false;
  const w = WEAPONS[player.weapon];
  const wantFire = w.auto ? input.fire : input.firePressed;
  input.firePressed = false;
  if (!wantFire) { player.burst = 0; return false; }
  if (now - player.lastShot < w.rate) return false;
  if (player.mag <= 0) {
    sfx.dryFire();
    startReload(player);
    return false;
  }
  const spread = currentSpread(player);
  spreadDir(player.yaw, player.pitch + player.recoil, spread, DIR);
  EYE.x = player.pos.x;
  EYE.y = player.pos.y + eyeHeight(player.crouched);
  EYE.z = player.pos.z;
  const res = fireShot(state, fighters, player, DIR, EYE);
  state.tracers.push({
    from: { x: EYE.x, y: EYE.y, z: EYE.z },
    to: { x: EYE.x + DIR.x * res.dist, y: EYE.y + DIR.y * res.dist, z: EYE.z + DIR.z * res.dist },
    born: now, life: 0.06, color: w.tracer,
  });
  if (res.hit) {
    state.hitAt = now;
    state.hitKill = !res.target.alive;
    if (res.zone === 'head') { sfx.headshot(); state.stats.headshots += 1; }
    else sfx.hit();
    state.stats.hits += 1;
    if (!res.target.alive) {
      // kill bonus lands in the wallet immediately
      player.money += 300;
      state.playerMoney = player.money;
    }
  }
  state.stats.shots += 1;
  player.mag -= 1;
  player.lastShot = now;
  player.burst += 1;
  player.spreadBloom = Math.min(0.05, player.spreadBloom + w.bloom);
  player.recoil = Math.min(0.09, player.recoil + w.recoil);
  sfx.shot(w.kind, 0);
  hearShot(state, fighters, player, player.pos.x, player.pos.z);
  return true;
}

export function startReload(player) {
  const w = WEAPONS[player.weapon];
  if (player.reloading > 0 || player.mag >= w.mag || player.reserve <= 0) return;
  player.reloading = w.reload;
  sfx.reload();
}

// Throw a mist grenade toward where the player looks; it blooms into a
// smoke sphere that blocks bot sightlines for 14 seconds.
export function throwGrenade(state, player) {
  if (player.grenades <= 0) return false;
  player.grenades -= 1;
  const cp = Math.cos(player.pitch);
  const vx = -Math.sin(player.yaw) * cp * 14;
  const vz = -Math.cos(player.yaw) * cp * 14;
  // land point: march forward until a wall or 12 m
  let x = player.pos.x, z = player.pos.z;
  for (let i = 0; i < 24; i++) {
    const nx = x + vx * 0.05, nz = z + vz * 0.05;
    const probe = { x: nx, z: nz };
    collideCircle(probe, 0.1);
    if (probe.x !== nx || probe.z !== nz) break;
    x = nx; z = nz;
  }
  state.smokes.push({ x, z, r: 4.2, born: state.time, life: 14 });
  sfx.grenade();
  return true;
}
