// EMBERLINE — central game state. One plain object owns every fact the sim
// and the renderer read; modules never keep their own copy of match state.
export const TEAM = { AMBER: 'amber', VIOLET: 'violet' };

export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  LIVE: 'live',
  PLANTED: 'planted',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export function freshState() {
  return {
    phase: PHASE.MENU,
    round: 1,
    wins: { amber: 0, violet: 0 }, // rounds won per team
    firstTo: 8,
    half: 1, // sides swap after round 5
    attackers: TEAM.AMBER, // team that plants the spike
    money: { amber: 800, violet: 800 }, // per-side wallet of the human player side; bots share a purse
    playerMoney: 800,
    roundTime: 100, // seconds left in the live round
    buyTime: 20,
    fuseTime: 35, // spike fuse once planted
    plant: { state: 'idle', site: null, progress: 0, carrier: null, plantedBy: null, defuseProgress: 0, defuser: null },
    kills: [],
    feed: [], // { text, t } killfeed lines
    banner: '', // big centre message
    bannerSub: '',
    bannerUntil: 0,
    time: 0, // sim clock, seconds
    roundKills: 0,
    smokes: [], // { pos: {x,z}, born, life }
    flashes: [],
    tracers: [],
    decals: [],
    winner: null,
    lossStreak: { amber: 0, violet: 0 },
    stats: { shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0 },
  };
}

// A fighter is anything with a body in the sim: the human player plus bots.
// pos is feet position (y = ground). yaw faces +Z when 0.
export function freshFighter(id, team, isPlayer, name) {
  return {
    id, team, isPlayer, name,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0,
    hp: 100, armor: 0,
    alive: true,
    crouched: false,
    onGround: true,
    speed: 0, // horizontal speed, for spread
    weapon: 'pistol',
    mag: 12, reserve: 48,
    reloading: 0, // seconds left, 0 = not reloading
    lastShot: -9,
    burst: 0, // shots in current trigger pull, drives bloom
    recoil: 0, // accumulated pitch kick waiting to be applied
    spreadBloom: 0,
    grenades: 0,
    hasSpike: false,
    planting: 0, // seconds of plant held, 0 = not planting
    defusing: 0,
    bot: null, // bot brain, null for the human
    flashUntil: 0,
    deadAt: 0,
    kills: 0,
    deaths: 0,
    money: 800,
  };
}
