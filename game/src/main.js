// EMBERLINE — bootstrap and the game loop. The simulation runs at a fixed
// 60 Hz and never reads the frame clock; rendering only mirrors sim state.
// That split is what keeps gunplay identical on any machine.
import * as THREE from 'three';
import { freshState, freshFighter, PHASE, TEAM } from './state.js';
import { buildMap, eyeHeight, inSite, SITES } from './map.js';
import { buildTeams, startMatch, tickRound, PLANT_SECONDS, DEFUSE_SECONDS } from './rounds.js';
import { createInput, applyLook, stepPlayer, stepTrigger, startReload, throwGrenade } from './player.js';
import { updateBot } from './bots.js';
import { ensureAudio, sfx } from './audio.js';
import { updateHUD, buildBuyMenu } from './hud.js';
import { Renderer } from './render.js';
import { WEAPONS, GRENADE, ARMOR, equip } from './weapons.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT_MODE = params.get('shot'); // start | buy | plant | combat — staged scenes for screenshots

const state = freshState();
const player = freshFighter(0, TEAM.AMBER, true, 'You');
const fighters = [];
buildTeams(fighters, player);

const container = document.getElementById('game');
const renderer3 = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer3.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer3.setSize(window.innerWidth, window.innerHeight);
renderer3.shadowMap.enabled = true;
renderer3.shadowMap.type = THREE.PCFSoftShadowMap;
renderer3.toneMapping = THREE.ACESFilmicToneMapping;
renderer3.toneMappingExposure = 1.05;
container.appendChild(renderer3.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 400);
scene.add(camera);
buildMap(scene);
const view = new Renderer(scene, camera);

const input = createInput();
const dirOut = { x: 0, y: 0, z: 0 }; // reused aim scratch vector
let accumulator = 0;
let lastFrame = performance.now();
let pointerLocked = false;
let stepCount = 0;

// ---- input wiring ----
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer3.domElement;
});
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  input.mouseDX += e.movementX;
  input.mouseDY += e.movementY;
});
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && pointerLocked) { input.fire = true; input.firePressed = true; }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
});
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyW': input.fwd = true; break;
    case 'KeyA': input.left = true; break;
    case 'KeyS': input.back = true; break;
    case 'KeyD': input.right = true; break;
    case 'ControlLeft': case 'ControlRight': input.crouch = true; break;
    case 'Space': input.jump = true; e.preventDefault(); break;
    case 'KeyR': if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) startReload(player); break;
    case 'KeyB':
      if (state.phase === PHASE.BUY) {
        state.buyOpen = !state.buyOpen;
        if (state.buyOpen) document.exitPointerLock();
        else lockPointer();
      }
      break;
    case 'KeyG':
      if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) throwGrenade(state, player);
      break;
    case 'KeyE': input.plant = true; break;
    case 'Digit1': tryBuy('smg'); break;
    case 'Digit2': tryBuy('rifle'); break;
    case 'Digit3': tryBuy('sniper'); break;
    case 'Digit4': tryBuy('grenade'); break;
    case 'Digit5': tryBuy('armor'); break;
  }
});
document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': input.fwd = false; break;
    case 'KeyA': input.left = false; break;
    case 'KeyS': input.back = false; break;
    case 'KeyD': input.right = false; break;
    case 'ControlLeft': case 'ControlRight': input.crouch = false; break;
    case 'Space': input.jump = false; break;
    case 'KeyE': input.plant = false; break;
  }
});
renderer3.domElement.addEventListener('click', () => {
  if (state.phase !== PHASE.MENU && !state.buyOpen && !pointerLocked) lockPointer();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer3.setSize(window.innerWidth, window.innerHeight);
});

function lockPointer() {
  renderer3.domElement.requestPointerLock();
}

// ---- buying ----
function tryBuy(id) {
  if (state.phase !== PHASE.BUY || !state.buyOpen) return;
  const p = player;
  if (id === 'grenade') {
    if (p.grenades >= GRENADE.max || p.money < GRENADE.price) return;
    p.money -= GRENADE.price; p.grenades += 1;
  } else if (id === 'armor') {
    if (p.armor >= 100 || p.money < ARMOR.price) return;
    p.money -= ARMOR.price; p.armor = 100;
  } else {
    const w = WEAPONS[id];
    if (!w || p.money < w.price) return;
    p.money -= w.price;
    equip(p, id);
    view.setWeapon(id);
  }
  state.playerMoney = p.money;
  sfx.buy();
}

buildBuyMenu((id) => tryBuy(id));

// ---- match control ----
document.getElementById('play').addEventListener('click', () => {
  ensureAudio();
  document.getElementById('overlay').hidden = true;
  state.buyOpen = true;
  startMatch(state, fighters, player);
  // no pointer lock yet: the buy menu is open and needs the mouse
});

// ---- plant / defuse (hold E) ----
function stepInteract(dt) {
  const inA = inSite(SITES.A, player.pos.x, player.pos.z);
  const inB = inSite(SITES.B, player.pos.x, player.pos.z);
  const site = inA ? 'A' : inB ? 'B' : null;
  const attacking = player.team === state.attackers;
  if (!player.alive || !input.plant) {
    player.planting = 0; player.defusing = 0;
    return;
  }
  if (attacking && player.hasSpike && site && (state.phase === PHASE.LIVE)) {
    player.planting += dt;
    player.defusing = 0;
    if (Math.floor(player.planting * 10) !== Math.floor((player.planting - dt) * 10)) sfx.plantBeep();
    return;
  }
  if (!attacking && state.phase === PHASE.PLANTED && site === state.plant.site) {
    player.defusing += dt;
    player.planting = 0;
    if (Math.floor(player.defusing * 5) !== Math.floor((player.defusing - dt) * 5)) sfx.defuseBeep();
    return;
  }
  player.planting = 0; player.defusing = 0;
}

// ---- the fixed-step sim: one tick, pure state in, state out ----
function step(dt) {
  state.time += dt;
  stepCount += 1;
  applyLook(player, input, dt);
  if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED || state.phase === PHASE.BUY) {
    stepPlayer(state, player, input, dt);
    if (state.phase !== PHASE.BUY) {
      stepTrigger(state, fighters, player, input, state.time);
      stepInteract(dt);
    }
    tickRound(state, fighters, dt);
    if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) {
      for (const f of fighters) {
        if (f.isPlayer || !f.bot) continue;
        updateBot(state, fighters, f, dt, dirOut);
      }
    }
    // footsteps
    if (player.speed > 1 && player.onGround && stepCount % 24 === 0) sfx.step(player.speed > 4);
  }
  // round-end jingle, once
  if (state.phase === PHASE.ROUND_END && state.roundWinSound) {
    if (state.roundWinSound === 'win') sfx.roundWin(); else sfx.roundLose();
    state.roundWinSound = null;
  }
  if (state.phase === PHASE.MATCH_END && state.matchSound !== 'played') {
    state.matchSound = 'played';
    if (state.winner === player.team) sfx.roundWin(); else sfx.roundLose();
    const overlay = document.getElementById('overlay');
    if (overlay.hidden) {
      overlay.hidden = false;
      document.getElementById('play').textContent = 'PLAY AGAIN';
      document.exitPointerLock();
    }
  }
  // spike fuse beeps
  if (state.phase === PHASE.PLANTED) {
    const whole = Math.ceil(state.fuseTime);
    if (whole !== state._beepAt) { state._beepAt = whole; sfx.spikeBeep(whole <= 10); }
  }
  // smoke expiry
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (state.time - state.smokes[i].born > state.smokes[i].life) state.smokes.splice(i, 1);
  }
}

// ---- staged screenshot scenes: real gameplay states, no pointer lock ----
function stageShot(mode) {
  ensureAudio();
  document.getElementById('overlay').hidden = true;
  startMatch(state, fighters, player);
  state.buyOpen = false;
  if (mode === 'buy') {
    state.phase = PHASE.BUY;
    state.buyTime = 18;
    state.buyOpen = true;
    player.money = 4700;
    state.playerMoney = 4700;
    player.pos.x = -24; player.pos.z = 0;
    player.yaw = -Math.PI / 2;
  } else if (mode === 'plant') {
    // spike already planted at A: the player holds the site, fuse ticking
    state.phase = PHASE.PLANTED;
    state.plant.state = 'planted';
    state.plant.site = 'A';
    state.plant.plantedBy = 'Mara';
    state.fuseTime = 31;
    state.roundTime = 0;
    equip(player, 'rifle');
    view.setWeapon('rifle');
    player.pos.x = 22.5; player.pos.z = -15;
    player.yaw = -2.4;
    player.pitch = -0.05;
    const ally = fighters[1];
    ally.pos.x = 19; ally.pos.z = -19; ally.yaw = 2.2;
    const enemy = fighters[5];
    enemy.pos.x = 27; enemy.pos.z = -11; enemy.yaw = -1.6;
    enemy.spottedAt = state.time;
  } else if (mode === 'combat') {
    state.phase = PHASE.LIVE;
    state.roundTime = 74;
    equip(player, 'rifle');
    view.setWeapon('rifle');
    player.pos.x = -14; player.pos.z = -18;
    player.yaw = -1.35;
    player.pitch = 0.02;
    const enemy = fighters[5];
    enemy.pos.x = 2; enemy.pos.z = -19.5; enemy.yaw = 2.4;
    enemy.spottedAt = state.time;
    const enemy2 = fighters[6];
    enemy2.pos.x = 10; enemy2.pos.z = -8; enemy2.yaw = 2.0;
    enemy2.spottedAt = state.time;
    const ally = fighters[2];
    ally.pos.x = -8; ally.pos.z = -12; ally.yaw = -1.2;
    state.feed.unshift({ text: 'You ✕ Rook (headshot)', t: state.time });
  } else {
    // 'start' cover: mid-lane view with the round live
    state.phase = PHASE.LIVE;
    state.roundTime = 88;
    equip(player, 'rifle');
    view.setWeapon('rifle');
    player.pos.x = -20; player.pos.z = 2;
    player.yaw = -1.5;
    player.pitch = 0;
    const enemy = fighters[5];
    enemy.pos.x = 4; enemy.pos.z = 1; enemy.yaw = 2.6;
    enemy.spottedAt = state.time;
    const ally = fighters[1];
    ally.pos.x = -12; ally.pos.z = -3; ally.yaw = -1.4;
  }
  // settle the sim for a few frames so poses and HUD are live
  for (let i = 0; i < 30; i++) step(STEP);
  state.stagePos = { x: player.pos.x, z: player.pos.z, yaw: player.yaw, pitch: player.pitch };
}

if (SHOT_MODE) {
  stageShot(SHOT_MODE);
  // keep the sim ticking at the staged state so smoke/tracers stay alive;
  // the staged player cannot die, or the screenshots would show a corpse
  setInterval(() => {
    for (let i = 0; i < 6; i++) step(STEP);
    if (!player.alive && state.stagePos) {
      player.alive = true;
      player.hp = 100;
      player.pos.x = state.stagePos.x;
      player.pos.z = state.stagePos.z;
      player.yaw = state.stagePos.yaw;
      player.pitch = state.stagePos.pitch;
    }
  }, 100);
}

// ---- frame loop: accumulate real time, run whole fixed steps, render ----
function frame(now) {
  requestAnimationFrame(frame);
  if (window.__emberFreeze) return; // screenshot staging: hold the last frame
  window.__emberFrames = (window.__emberFrames || 0) + 1;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!SHOT_MODE) {
    accumulator += dt;
    let n = 0;
    while (accumulator >= STEP && n < 5) {
      step(STEP);
      accumulator -= STEP;
      n += 1;
    }
    if (n === 5) accumulator = 0;
  }
  view.syncCamera(player, dt, state.time);
  view.syncBots(fighters, state.time);
  view.syncEffects(state, state.time);
  view.drawMinimap(fighters, state);
  updateHUD(state, fighters);
  renderer3.render(scene, camera);
}
requestAnimationFrame(frame);
