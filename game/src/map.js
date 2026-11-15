// EMBERLINE — "Kestrel Yard": an original desert freight yard, not a copy of
// any commercial map. Three lanes run west (Amber spawn) to east (Violet
// spawn): A-Long along the north wall, Mid through the container stacks, and
// B-Lane along the south wall, with a connector cutting between the two sites.
// Everything is built from boxes and planes in one tight palette.
import * as THREE from 'three';

// ---- palette (one dusk-desert set, reused by every mesh) ----
export const PAL = {
  sand: 0xc9a06a, sandDark: 0xa9854f, concrete: 0x8f8a80,
  rust: 0x9a5a34, rustDark: 0x6e3f26, teal: 0x2e6f73, tealDark: 0x1f4d50,
  ochre: 0xd99a2b, grey: 0x5c6066, dark: 0x3a3d42,
  amberSite: 0xe8a33d, violetSite: 0x7a5fd0,
  skyTop: 0x2e3a5e, skyLow: 0xe08a4e, fog: 0xc98a5e,
};

const EYE = 1.62; // standing eye height; crouched 1.15

// ---- colliders: axis-aligned boxes the sim treats as solid ----
// { x0, z0, x1, z1, h } — h is top height; anything h >= 1.2 blocks bullets at eye level.
export const COLLIDERS = [];
function solid(x0, z0, x1, z1, h) {
  COLLIDERS.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h });
}

// Perimeter walls (tall) plus the lane furniture.
function defineSolids() {
  COLLIDERS.length = 0;
  // outer walls
  solid(-33, -25, 33, -24, 6); solid(-33, 24, 33, 25, 6);
  solid(-33, -25, -32, 25, 6); solid(32, -25, 33, 25, 6);
  // A-Long: two container stacks + a low wall for cover
  solid(-20, -22.5, -12, -19.5, 2.6); solid(-4, -22.5, 2, -20, 2.6);
  solid(8, -21, 12, -19.2, 1.2);
  // Mid: crate clusters that break the sightline
  solid(-10, -3, -6, 1, 2.4); solid(-2, 4, 2, 8, 1.2); solid(-1, -8, 3, -4, 2.4);
  solid(6, -2, 10, 2, 1.2); solid(12, 6, 16, 9, 2.4);
  // Connector walls (the cut between the sites has a solid spine)
  solid(14, -8, 15, -2, 3.2); solid(14, 2, 15, 8, 3.2);
  // B-Lane: container + crates + a tunnel-ish low roof block
  solid(-22, 19, -14, 22, 2.6); solid(-6, 17, -1, 20.5, 1.2); solid(4, 19, 10, 21.5, 2.6);
  solid(18, 15, 24, 17, 2.4);
  // Site A furniture
  solid(24, -21, 28, -18, 2.6); solid(20, -13, 23, -10.5, 1.2);
  // Site B furniture
  solid(25, 18, 29, 21, 2.6); solid(20, 11, 22.5, 14, 1.2);
  // Spawn cover
  solid(-28, -6, -25, -3, 1.2); solid(-28, 3, -25, 6, 1.2);
  solid(26, -5, 29, -2, 1.2); solid(26, 2, 29, 5, 1.2);
}

// ---- sites, spawns, waypoints ----
export const SITES = {
  A: { name: 'A', cx: 24, cz: -16, r: 5.5 },
  B: { name: 'B', cx: 24, cz: 16, r: 5.5 },
};
export const SPAWNS = {
  amber: [
    { x: -29, z: -8 }, { x: -29, z: -3 }, { x: -29, z: 2 }, { x: -29, z: 7 }, { x: -27, z: 0 },
  ],
  violet: [
    { x: 29, z: -8 }, { x: 29, z: -3 }, { x: 29, z: 2 }, { x: 29, z: 7 }, { x: 27, z: 0 },
  ],
};

// Waypoint graph: nodes on walkable ground, edges between neighbours.
// Bots pathfind with BFS over this graph, then steer node to node.
export const WAYPOINTS = [
  // id, x, z, neighbours
  [0, -28, 0, [1, 5]], [1, -22, -12, [0, 2, 5]], [2, -12, -20, [1, 3]],
  [3, 2, -20, [2, 4, 8]], [4, 14, -18, [3, 9, 10]],
  [5, -22, 8, [0, 6, 7]], [6, -12, 14, [5, 7]], [7, 0, 17, [6, 8, 11]],
  [8, 12, 0, [3, 7, 9, 12]], [9, 20, -12, [4, 8, 13]],
  [10, 16, -6, [4, 13]], [11, 14, 14, [7, 12, 14]],
  [12, 18, 4, [8, 11, 13, 14]], [13, 24, -16, [9, 10, 12]],
  [14, 24, 16, [11, 12]], [15, 28, 0, [12, 13, 14]],
  [16, -18, 0, [0, 5, 1]], [17, -4, -10, [2, 3, 8]],
];

// ---- collision helpers (pure, used by the fixed-step sim) ----
export function collideCircle(p, radius) {
  // Push a 2D circle out of every solid it overlaps. Runs on plain numbers.
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    const nx = Math.max(c.x0, Math.min(p.x, c.x1));
    const nz = Math.max(c.z0, Math.min(p.z, c.z1));
    const dx = p.x - nx, dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = nx + (dx / d) * radius;
        p.z = nz + (dz / d) * radius;
      } else {
        // centre inside the box: shove out along the smallest penetration axis
        const pl = p.x - c.x0, pr = c.x1 - p.x, pt = p.z - c.z0, pb = c.z1 - p.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) p.x = c.x0 - radius; else if (m === pr) p.x = c.x1 + radius;
        else if (m === pt) p.z = c.z0 - radius; else p.z = c.z1 + radius;
      }
    }
  }
  // clamp to the yard
  p.x = Math.max(-31.6, Math.min(31.6, p.x));
  p.z = Math.max(-23.6, Math.min(23.6, p.z));
}

// 2D segment vs solids at eye height: does a wall block line of sight?
export function losBlocked(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    if (c.h < 1.35) continue; // low crates never block a standing sightline
    // slab test in 2D
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (x0 < c.x0 || x0 > c.x1) continue; }
    else {
      let ta = (c.x0 - x0) / dx, tb = (c.x1 - x0) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (z0 < c.z0 || z0 > c.z1) continue; }
    else {
      let ta = (c.z0 - z0) / dz, tb = (c.z1 - z0) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

export function inSite(site, x, z) {
  const dx = x - site.cx, dz = z - site.cz;
  return dx * dx + dz * dz < site.r * site.r;
}

export function eyeHeight(crouched) { return crouched ? 1.15 : EYE; }

// BFS over the waypoint graph; returns an array of node ids from `from` to `to`.
export function findPath(from, to) {
  if (from === to) return [to];
  const prev = new Int16Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const n = queue.shift();
    for (const m of WAYPOINTS[n][3]) {
      if (prev[m] === -1) {
        prev[m] = n;
        if (m === to) {
          const path = [to];
          let c = n;
          while (c !== from) { path.push(c); c = prev[c]; }
          path.reverse();
          return path;
        }
        queue.push(m);
      }
    }
  }
  return [to];
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][1] - x, dz = WAYPOINTS[i][2] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ---- visuals: build the yard's meshes into the scene ----
export function buildMap(scene) {
  defineSolids();
  const mats = {
    sand: new THREE.MeshStandardMaterial({ color: PAL.sand, roughness: 1 }),
    sandDark: new THREE.MeshStandardMaterial({ color: PAL.sandDark, roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ color: PAL.concrete, roughness: 0.95 }),
    rust: new THREE.MeshStandardMaterial({ color: PAL.rust, roughness: 0.85, metalness: 0.15 }),
    rustDark: new THREE.MeshStandardMaterial({ color: PAL.rustDark, roughness: 0.9, metalness: 0.1 }),
    teal: new THREE.MeshStandardMaterial({ color: PAL.teal, roughness: 0.8, metalness: 0.2 }),
    tealDark: new THREE.MeshStandardMaterial({ color: PAL.tealDark, roughness: 0.85, metalness: 0.15 }),
    ochre: new THREE.MeshStandardMaterial({ color: PAL.ochre, roughness: 0.8, metalness: 0.2 }),
    grey: new THREE.MeshStandardMaterial({ color: PAL.grey, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: PAL.dark, roughness: 0.95 }),
  };
  const group = new THREE.Group();
  group.name = 'kestrel-yard';

  // ground: sand with a darker concrete apron at each site
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 50), mats.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  for (const s of [SITES.A, SITES.B]) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), mats.concrete);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.cx, 0.01, s.cz);
    pad.receiveShadow = true;
    group.add(pad);
    // site letter, painted flat on the pad
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.9, 40),
      new THREE.MeshBasicMaterial({ color: s.name === 'A' ? PAL.amberSite : PAL.violetSite, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.cx, 0.02, s.cz);
    group.add(ring);
  }

  // mid lane strip, slightly darker, so the three lanes read at a glance
  const mid = new THREE.Mesh(new THREE.PlaneGeometry(20, 50), mats.sandDark);
  mid.rotation.x = -Math.PI / 2;
  mid.position.set(-2, 0.005, 0);
  mid.receiveShadow = true;
  group.add(mid);

  // perimeter walls
  const wallMat = mats.concrete;
  const mkWall = (x, z, w, d, h) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  };
  mkWall(0, -24.5, 66, 1, 5); mkWall(0, 24.5, 66, 1, 5);
  mkWall(-32.5, 0, 1, 50, 5); mkWall(32.5, 0, 1, 50, 5);

  // every solid gets a box; material cycles so the yard is not one colour
  const boxMats = [mats.rust, mats.teal, mats.ochre, mats.grey, mats.rustDark, mats.tealDark];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    if (c.h >= 5) continue; // perimeter already drawn
    const w = c.x1 - c.x0, d = c.z1 - c.z0;
    const m = new THREE.Mesh(boxGeo, boxMats[i % boxMats.length]);
    m.scale.set(w, c.h, d);
    m.position.set((c.x0 + c.x1) / 2, c.h / 2, (c.z0 + c.z1) / 2);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    // thin pale lid so crate tops catch the sun
    if (c.h > 1.5) {
      const lid = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.08, d + 0.06), mats.dark);
      lid.position.set((c.x0 + c.x1) / 2, c.h + 0.04, (c.z0 + c.z1) / 2);
      group.add(lid);
    }
  }

  // hanging lamps over the lanes (emissive + real point light, only four)
  const lampPos = [[-16, -16], [0, 0], [16, -12], [0, 16]];
  const lampGeo = new THREE.SphereGeometry(0.22, 12, 8);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const poleMat = new THREE.MeshStandardMaterial({ color: PAL.dark, roughness: 0.7, metalness: 0.4 });
  for (const [x, z] of lampPos) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.6, 8), poleMat);
    pole.position.set(x, 2.3, z);
    group.add(pole);
    const bulb = new THREE.Mesh(lampGeo, lampMat);
    bulb.position.set(x, 4.55, z);
    group.add(bulb);
    const light = new THREE.PointLight(0xffc27a, 18, 16, 1.6);
    light.position.set(x, 4.3, z);
    group.add(light);
  }

  // dusk sky: big gradient dome + low sun
  const skyGeo = new THREE.SphereGeometry(180, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(PAL.skyTop) }, low: { value: new THREE.Color(PAL.skyLow) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 low; void main(){ float t = clamp(vP.y / 120.0 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(low, top, t), 1.0); }',
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(PAL.fog, 55, 170);

  const sun = new THREE.DirectionalLight(0xffb36b, 2.4);
  sun.position.set(-30, 38, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  group.add(sun);
  scene.add(new THREE.HemisphereLight(0x8a7fb0, 0x8a6a4a, 0.85));
  scene.add(group);
  return { group, colliders: COLLIDERS };
}
