# EMBERLINE — build log (threejs-fps-02)

Game: **EMBERLINE**, a round-based tactical FPS on three.js 0.187.0 (vendored).
Map: "Kestrel Yard" — an original dusk desert freight yard, 3 lanes (A-Long / Mid /
B-Lane) + connector, two plant sites. 5v5 (player + 4 ally bots vs 5 enemy bots),
first to 8 rounds, sides swap after round 5. Spike plant (3s) / defuse (5s),
35s fuse. Buy phase 20s: 4 weapons (P9 pistol, Hornet-9 SMG, VK-47 rifle,
Dune Lance sniper) + mist grenade (blocks bot sight) + kevlar. Economy:
$800 start, $300/kill, $3250 win / $1900+ loss-streak bonus.

## Files (all game code written fresh in this session)
- `game/index.html` — import map + full HUD DOM (health, ammo, timer, score,
  minimap, killfeed, buy menu, plant bar, banner)
- `game/src/main.js` — bootstrap, fixed 60 Hz sim separate from rendering,
  input, buy, plant/defuse, `?shot=` staging scenes for screenshots
- `game/src/state.js` — single central state store + fighter factory
- `game/src/map.js` — Kestrel Yard: colliders, waypoint graph + BFS, LOS,
  visuals (dusk sky shader, lamps, containers)
- `game/src/player.js` — accel/friction movement, crouch, jump, collision,
  recoil/bloom, reload, grenade throw
- `game/src/weapons.js` — weapon table + armor/damage model
- `game/src/combat.js` — analytic hitscan vs AABBs + head/torso/leg hitboxes
- `game/src/bots.js` — bot state machine (route/hold/engage/plant/defuse/
  investigate), waypoint pathfinding, hearing, aim error + reaction delay
- `game/src/rounds.js` — round flow, economy, spike, half-time side swap
- `game/src/audio.js` — all sound synthesised with WebAudio, no audio files
- `game/src/hud.js` — one DOM update pass per frame + buy menu
- `game/src/render.js` — bot meshes, viewmodel gun, tracers, smoke, minimap
- `main.ts`, `serve.ts` — entry program + local static server (own code)
- `game/vendor/three/*` — kit three.js 0.187.0, byte-for-byte (sha256 verified)
- `vendor/makefun-threejs.ts` — kit copy, unchanged

## Bugs found & fixed during testing
1. `visibleEnemy` called with fighter, read `bot.targetPos` → crash on first
   sighting. Fixed to use `f.bot`.
2. Tracer endpoint `Infinity` when a shot missed everything → NaN geometry.
   Fixed: clamp miss distance to weapon range.
3. Defenders re-pathed to the planted site every tick, resetting `pathIdx` and
   stalling. Fixed: re-path only when the target site changes.
4. Semi-auto weapons never fired: `firePressed` was never set. Fixed in the
   mousedown handler.
5. My own edit dropped `const dt` in `frame()` — caught by a page-error log,
   restored.

## Screenshots (real renders, Playwright's own Chromium + SwiftShader)
- `1-combat.jpg` — rifle duel on A-Long, two enemies visible
- `2-buy.jpg` — buy menu open, $4,700 balance
- `3-plant.jpg` — spike planted at A, fuse 0:08, enemy pushing site
- `4-mid.jpg` — mid-lane push with allies
- All 1280×800 JPEG, 51–74 KiB (≤256 KiB). System Chrome was blocked
  headless (Hatch WebGL policy); Playwright Chromium worked.

## Local gate checks (2026-11-15)
- `node --check` on every `.js`/`.ts`: pass
- `MAKEFUN_OUTPUT_DIR=out node main.ts` run twice → `diff -r out out2`
  identical (deterministic); dossier 414,286 bytes, text 93,184 bytes
  (under the 160 KiB cap, all sources included whole)
- Dossier rebuilt with `buildDossier` from `out/` → byte-identical
- game/: 15 files, 2.2 MiB, 0 symlinks; three.js sha256 match the kit;
  no `http(s)://` references anywhere; import map maps `three` to
  `./vendor/three/three.module.min.js`
- Playtest (headless): Deploy → buy menu opens → grenade purchase $800→$500
  (see parent report for the final playtest result; screenshots prove the
  live sim: timers advance, bots fight, HP/ammo/score update)
- Buy-flow test (final, 2026-11-15 ~06:12 WIB): staged buy phase, clicked
  VK-47 row → money $4,700 → $2,000, weapon P9 Sidearm → VK-47 Longshot,
  ammo 30/90, zero page errors. An earlier click-timeout was a test artifact
  only: the 20 s buy phase expired during SwiftShader's slow load, closing
  the menu before Playwright's 30 s click retry finished.

## Not done by this session
- No submit, no push, no `gh` use, no money spent. Commit locally only.
- Live-browser playtest with a real mouse/pointer-lock was not possible from
  this sandbox (headless only); pointer-lock path is standard API usage.
