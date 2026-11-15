// EMBERLINE — rendering, kept apart from the sim. The sim writes plain
// numbers into state; this module mirrors them onto three.js objects. Meshes
// are created once and reused; per-frame work only moves them.
import * as THREE from 'three';
import { eyeHeight, SITES, COLLIDERS } from './map.js';
import { WEAPONS } from './weapons.js';

const TEAM_COLOR = { amber: 0xe8a33d, violet: 0x7a5fd0 };
const _v = new THREE.Vector3();

export class Renderer {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.botMeshes = new Map(); // fighter id -> { group, head, body, gun }
    this.tracerPool = [];
    this.smokeMeshes = new Map(); // index -> mesh
    this.spikeMesh = null;
    this.muzzle = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
    this.muzzle.position.set(0.4, -0.3, -1);
    camera.add(this.muzzle);
    this.buildGun();
    this.buildSpikeMarker();
    this.buildMinimap();
  }

  // ---- viewmodel: a low-poly gun built from boxes, parented to the camera
  buildGun() {
    const gun = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.7 });
    const mid = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.55, metalness: 0.6 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x6e3f26, roughness: 0.9 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.5, metalness: 0.4 });
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      gun.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark, 0, -0.16, -0.55); // receiver
    add(new THREE.BoxGeometry(0.06, 0.06, 0.34), mid, 0, -0.14, -0.95); // barrel
    add(new THREE.BoxGeometry(0.07, 0.05, 0.12), dark, 0, -0.22, -0.62); // grip
    add(new THREE.BoxGeometry(0.05, 0.09, 0.16), grip, 0, -0.26, -0.42); // stock grip
    add(new THREE.BoxGeometry(0.04, 0.05, 0.2), accent, 0, -0.085, -0.75); // sight rail
    add(new THREE.BoxGeometry(0.1, 0.03, 0.2), mid, 0, -0.23, -0.35); // magazine
    add(new THREE.BoxGeometry(0.02, 0.06, 0.02), accent, 0, -0.1, -1.12); // front sight
    gun.position.set(0.26, -0.24, -0.1);
    gun.rotation.y = 0.02;
    this.gun = gun;
    this.gunParts = { dark, mid };
    this.camera.add(gun);
  }

  setWeapon(kind) {
    // the sniper gets a longer barrel, the pistol a shorter body: scale the
    // same viewmodel instead of building four guns
    const s = kind === 'sniper' ? 1.25 : kind === 'pistol' ? 0.8 : kind === 'smg' ? 0.9 : 1;
    this.gun.scale.setScalar(s);
    this.gun.position.x = kind === 'pistol' ? 0.22 : 0.26;
  }

  buildSpikeMarker() {
    const geo = new THREE.OctahedronGeometry(0.22);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
    this.spikeMesh = new THREE.Mesh(geo, mat);
    this.spikeMesh.visible = false;
    this.scene.add(this.spikeMesh);
  }

  // ---- bot bodies: simple articulated figures, team-coloured ----
  botMesh(f) {
    let m = this.botMeshes.get(f.id);
    if (m) return m;
    const group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[f.team], roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), cloth);
    body.position.y = 1.12;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), skin);
    head.position.y = 1.63;
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.32), dark);
    helmet.position.y = 1.78;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), dark);
    legL.position.set(-0.14, 0.36, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.6, 0.15), cloth);
    armL.position.set(-0.33, 1.15, 0.1);
    armL.rotation.x = -1.1;
    const armR = armL.clone();
    armR.position.x = 0.33;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
    gun.position.set(0.1, 1.15, -0.3);
    for (const part of [body, head, helmet, legL, legR, armL, armR, gun]) {
      part.castShadow = true;
      group.add(part);
    }
    // name sprite above the head (allies) — a small floating plate
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.22),
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[f.team], transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    plate.position.y = 2.05;
    group.add(plate);
    this.scene.add(group);
    m = { group, head, body, legL, legR, plate };
    this.botMeshes.set(f.id, m);
    return m;
  }

  syncBots(fighters, now) {
    for (const f of fighters) {
      if (f.isPlayer) continue;
      const m = this.botMesh(f);
      const g = m.group;
      if (!f.alive) {
        // fall flat, then sink out of the way
        g.position.set(f.pos.x, Math.max(-0.9, 0.25 - (now - f.deadAt) * 0.12), f.pos.z);
        g.rotation.z = Math.PI / 2;
        g.rotation.y = f.yaw;
        m.plate.visible = false;
        continue;
      }
      m.plate.visible = f.team === fighters[0].team;
      g.position.set(f.pos.x, f.pos.y, f.pos.z);
      g.rotation.set(0, f.yaw, 0);
      if (f.crouched) g.scale.y = 0.78; else g.scale.y = 1;
      // walk cycle: legs swing with speed
      const swing = f.speed > 0.4 ? Math.sin(now * 11 + f.id) * 0.5 * Math.min(1, f.speed / 4) : 0;
      m.legL.rotation.x = swing;
      m.legR.rotation.x = -swing;
      // face the plate at the camera
      m.plate.lookAt(this.camera.position);
    }
  }

  // ---- tracers, smoke, spike ----
  syncEffects(state, now) {
    // tracers
    for (let i = this.tracerPool.length - 1; i >= 0; i--) {
      const t = this.tracerPool[i];
      if (now - t.born > t.life) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracerPool.splice(i, 1);
      }
    }
    for (const t of state.tracers) {
      if (t.drawn) continue;
      t.drawn = true;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(t.from.x, t.from.y, t.from.z),
        new THREE.Vector3(t.to.x, t.to.y, t.to.z),
      ]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: t.color, transparent: true, opacity: 0.5 }));
      this.scene.add(line);
      this.tracerPool.push({ line, born: t.born, life: t.life });
    }
    if (state.tracers.length > 40) state.tracers.splice(0, state.tracers.length - 40);

    // smoke spheres
    const seen = new Set();
    for (let i = 0; i < state.smokes.length; i++) {
      const s = state.smokes[i];
      seen.add(i);
      let mesh = this.smokeMeshes.get(i);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 18, 12),
          new THREE.MeshStandardMaterial({ color: 0xb8bcc2, transparent: true, opacity: 0.55, roughness: 1, depthWrite: false }),
        );
        this.scene.add(mesh);
        this.smokeMeshes.set(i, mesh);
      }
      const grow = Math.min(1, (now - s.born) * 1.5);
      mesh.scale.setScalar(s.r * grow);
      mesh.position.set(s.x, 1.4, s.z);
      const age = (now - s.born) / s.life;
      mesh.material.opacity = age > 0.8 ? 0.55 * (1 - (age - 0.8) / 0.2) : 0.55;
      mesh.visible = age < 1;
    }
    for (const [i, mesh] of this.smokeMeshes) {
      if (!seen.has(i)) { this.scene.remove(mesh); this.smokeMeshes.delete(i); }
    }

    // dropped spike marker, bobbing and spinning
    if (state.plant.state === 'dropped' && state.plant.droppedAt) {
      this.spikeMesh.visible = true;
      this.spikeMesh.position.set(state.plant.droppedAt.x, 0.5 + Math.sin(now * 3) * 0.08, state.plant.droppedAt.z);
      this.spikeMesh.rotation.y = now * 2;
    } else {
      this.spikeMesh.visible = false;
    }
  }

  // ---- camera + viewmodel kick ----
  syncCamera(player, dt, now) {
    const cam = this.camera;
    const eye = eyeHeight(player.crouched);
    cam.position.set(player.pos.x, player.pos.y + eye, player.pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = player.yaw;
    cam.rotation.x = player.pitch + player.recoil * 0.55;
    cam.rotation.z = 0;
    // gun kick: push back and up briefly after each shot
    const sinceShot = now - player.lastShot;
    const kick = sinceShot < 0.09 ? (1 - sinceShot / 0.09) * WEAPONS[player.weapon].kick : 0;
    this.gun.position.z = -0.1 + kick * 1.6;
    this.gun.rotation.x = kick * 2.2;
    // reload dip
    if (player.reloading > 0) {
      const w = WEAPONS[player.weapon];
      const f = 1 - player.reloading / w.reload;
      this.gun.rotation.x = -0.7 * Math.sin(f * Math.PI);
      this.gun.position.y = -0.24 - 0.12 * Math.sin(f * Math.PI);
    } else {
      this.gun.position.y = -0.24 + Math.sin(now * 2) * 0.002;
    }
    // muzzle flash light
    this.muzzle.intensity = sinceShot < 0.05 ? 26 : 0;
  }

  // ---- minimap: a 2D canvas, walls + sites + fighters ----
  buildMinimap() {
    this.mapCanvas = document.getElementById('minimap');
    if (!this.mapCanvas) return;
    this.mapCtx = this.mapCanvas.getContext('2d');
  }

  drawMinimap(fighters, state) {
    if (!this.mapCtx) return;
    const ctx = this.mapCtx;
    const W = 150, H = 114;
    const sx = (x) => (x + 33) / 66 * W;
    const sz = (z) => (z + 25) / 50 * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20, 22, 26, 0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(232, 163, 61, 0.25)';
    ctx.beginPath(); ctx.arc(sx(SITES.A.cx), sz(SITES.A.cz), 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(122, 95, 208, 0.25)';
    ctx.beginPath(); ctx.arc(sx(SITES.B.cx), sz(SITES.B.cz), 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(233, 230, 223, 0.5)';
    for (const c of COLLIDERS) ctx.fillRect(sx(c.x0), sz(c.z0), sx(c.x1) - sx(c.x0), sz(c.z1) - sz(c.z0));
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = '#e8a33d'; ctx.fillText('A', sx(SITES.A.cx) - 3, sz(SITES.A.cz) + 3);
    ctx.fillStyle = '#b7a5f5'; ctx.fillText('B', sx(SITES.B.cx) - 3, sz(SITES.B.cz) + 3);
    for (const f of fighters) {
      if (!f.alive) continue;
      const isEnemy = f.team !== fighters[0].team;
      if (isEnemy && (!f.spottedAt || state.time - f.spottedAt > 2.5)) continue;
      ctx.fillStyle = isEnemy ? '#ff5a3c' : f.isPlayer ? '#ffffff' : '#e8a33d';
      ctx.beginPath();
      ctx.arc(sx(f.pos.x), sz(f.pos.z), f.isPlayer ? 3.5 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
    void _v;
  }
}
