// EMBERLINE — round flow, economy and the spike objective. A match is first
// to 8 rounds; sides swap after round 5. The buy phase is 20 s, the live
// round is 100 s, the planted spike fuses in 35 s.
import { PHASE, TEAM, freshFighter } from './state.js';
import { SITES, inSite, SPAWNS } from './map.js';
import { equip } from './weapons.js';
import { assignRoute, makeBot } from './bots.js';

export const BUY_SECONDS = 20;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 35;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 5;
const WIN_BONUS = 3250;
const LOSS_BONUS = 1900;
const LOSS_STREAK_BONUS = 500;
const KILL_BONUS = 300;

const NAMES = {
  amber: ['Vex', 'Mara', 'Juno', 'Kite', 'Pip'],
  violet: ['Rook', 'Sable', 'Ivo', 'Nyx', 'Drex'],
};

export function buildTeams(fighters, player) {
  // fighters[0] is the human; 4 allies share the human's team, 5 enemies
  // take the other side. Names are original.
  fighters.length = 0;
  fighters.push(player);
  const lanes = ['A', 'MID', 'B', 'A'];
  for (let i = 0; i < 4; i++) {
    const bot = freshFighter(i + 1, player.team, false, NAMES[player.team][i]);
    makeBot(bot, player.team === TEAM.AMBER ? 'attack' : 'defend', lanes[i]);
    fighters.push(bot);
  }
  const enemyTeam = player.team === TEAM.AMBER ? TEAM.VIOLET : TEAM.AMBER;
  const enemyRole = enemyTeam === TEAM.AMBER ? 'attack' : 'defend';
  for (let i = 0; i < 5; i++) {
    const bot = freshFighter(10 + i, enemyTeam, false, NAMES[enemyTeam][i]);
    makeBot(bot, enemyRole, lanes[i % 3]);
    fighters.push(bot);
  }
}

export function startMatch(state, fighters, player) {
  state.wins = { amber: 0, violet: 0 };
  state.round = 1;
  state.half = 1;
  state.attackers = TEAM.AMBER;
  state.playerMoney = 800;
  state.matchSound = null;
  state.roundWinSound = null;
  state.winner = null;
  state.lossStreak = { amber: 0, violet: 0 };
  for (const f of fighters) {
    f.money = 800; f.kills = 0; f.deaths = 0;
    equip(f, 'pistol');
  }
  player.money = 800;
  startRound(state, fighters, player);
}

function spawnAll(state, fighters) {
  for (const f of fighters) {
    const spawns = SPAWNS[f.team];
    const s = spawns[f.id % spawns.length];
    f.pos.x = s.x + (Math.random() - 0.5) * 1.2;
    f.pos.z = s.z + (Math.random() - 0.5) * 1.2;
    f.yaw = f.team === TEAM.AMBER ? -Math.PI / 2 : Math.PI / 2;
    f.pitch = 0;
    f.hp = 100;
    f.alive = true;
    f.crouched = false;
    f.vel.x = 0; f.vel.z = 0;
    f.reloading = 0;
    f.planting = 0; f.defusing = 0;
    f.hasSpike = false;
    f.grenades = f.grenades || 0;
    if (f.bot) assignRoute(f, state.round);
  }
  // spike carrier: one random attacker bot (never the player, so the player
  // is free to hunt; a dropped spike can still be picked up)
  const carriers = fighters.filter((f) => f.team === state.attackers && !f.isPlayer && f.alive);
  const carrier = carriers[Math.floor(Math.random() * carriers.length)];
  if (carrier) carrier.hasSpike = true;
  state.plant.carrier = carrier ? carrier.id : null;
}

export function startRound(state, fighters, player) {
  state.phase = PHASE.BUY;
  state.buyTime = BUY_SECONDS;
  state.roundTime = ROUND_SECONDS;
  state.fuseTime = FUSE_SECONDS;
  state.plant = { state: 'idle', site: null, progress: 0, carrier: null, plantedBy: null, defuseProgress: 0, defuser: null };
  state.smokes = [];
  state.feed = [];
  // roles follow the current attacking side (swaps at half time)
  for (const f of fighters) if (f.bot) f.bot.role = f.team === state.attackers ? 'attack' : 'defend';
  spawnAll(state, fighters, player);
  banner(state, `ROUND ${state.round}`, state.attackers === player.team
    ? 'Your team attacks — plant the spike at A or B'
    : 'Your team defends — hold A and B');
}

export function banner(state, text, sub) {
  state.banner = text;
  state.bannerSub = sub || '';
  state.bannerUntil = state.time + 3.2;
}

function payRound(state, fighters, winner) {
  const loser = winner === TEAM.AMBER ? TEAM.VIOLET : TEAM.AMBER;
  state.wins[winner] += 1;
  state.lossStreak[loser] += 1;
  state.lossStreak[winner] = 0;
  for (const f of fighters) {
    const won = f.team === winner;
    f.money += won ? WIN_BONUS : LOSS_BONUS + Math.min(2, state.lossStreak[loser] - 1) * LOSS_STREAK_BONUS;
    if (won && f.isPlayer) state.playerMoney = f.money;
    if (!won && f.isPlayer) state.playerMoney = f.money;
  }
}

export function endRound(state, fighters, winner, reason) {
  if (state.phase === PHASE.ROUND_END || state.phase === PHASE.MATCH_END) return;
  payRound(state, fighters, winner);
  const playerWon = winner === fighters[0].team;
  banner(state, playerWon ? 'ROUND WON' : 'ROUND LOST', reason);
  state.phase = PHASE.ROUND_END;
  state.roundEndAt = state.time + 4;
  state.roundWinner = winner;
  state.roundWinSound = playerWon ? 'win' : 'lose';
  if (state.wins[winner] >= state.firstTo) {
    state.phase = PHASE.MATCH_END;
    state.winner = winner;
    banner(state, winner === fighters[0].team ? 'VICTORY' : 'DEFEAT',
      `${state.wins.amber} — ${state.wins.violet} · first to ${state.firstTo}`);
  }
}

function aliveCount(fighters, team) {
  let n = 0;
  for (const f of fighters) if (f.alive && f.team === team) n += 1;
  return n;
}

// Called every fixed step while a round is live.
export function tickRound(state, fighters, dt) {
  const player = fighters[0];
  if (state.phase === PHASE.BUY) {
    state.buyTime -= dt;
    if (state.buyTime <= 0) {
      state.phase = PHASE.LIVE;
      state.roundTime = ROUND_SECONDS;
      banner(state, 'GO GO GO', '');
    }
    return;
  }
  if (state.phase === PHASE.ROUND_END) {
    if (state.time >= state.roundEndAt) {
      if (state.phase === PHASE.MATCH_END) return;
      state.round += 1;
      if (state.round === 6) {
        state.half = 2;
        state.attackers = state.attackers === TEAM.AMBER ? TEAM.VIOLET : TEAM.AMBER;
        banner(state, 'HALF TIME — SIDES SWAP', '');
      }
      startRound(state, fighters, player);
    }
    return;
  }
  if (state.phase !== PHASE.LIVE && state.phase !== PHASE.PLANTED) return;

  // spike plant progress: anyone holding plant inside a site
  let planter = null;
  for (const f of fighters) {
    if (!f.alive || f.team !== state.attackers) continue;
    if (f.planting > 0) {
      const site = inSite(SITES.A, f.pos.x, f.pos.z) ? 'A' : inSite(SITES.B, f.pos.x, f.pos.z) ? 'B' : null;
      if (site) { planter = f; state.plant.site = site; }
    }
  }
  if (planter) {
    state.plant.state = 'planting';
    state.plant.progress += dt / PLANT_SECONDS;
    if (state.plant.progress >= 1) {
      state.plant.state = 'planted';
      state.plant.plantedBy = planter.name;
      state.fuseTime = FUSE_SECONDS;
      state.phase = PHASE.PLANTED;
      planter.hasSpike = false;
      planter.planting = 0;
      banner(state, 'SPIKE PLANTED', `Site ${state.plant.site} — ${FUSE_SECONDS}s to detonation`);
    }
  } else if (state.plant.state === 'planting') {
    state.plant.state = 'idle';
    state.plant.progress = 0;
  }

  // defuse progress while planted
  if (state.phase === PHASE.PLANTED) {
    state.fuseTime -= dt;
    let defuser = null;
    for (const f of fighters) {
      if (!f.alive || f.team === state.attackers) continue;
      if (f.defusing > 0 && inSite(SITES[state.plant.site], f.pos.x, f.pos.z)) defuser = f;
    }
    if (defuser) {
      state.plant.defuseProgress += dt / DEFUSE_SECONDS;
      if (state.plant.defuseProgress >= 1) {
        endRound(state, fighters, defuser.team, `Spike defused by ${defuser.name}`);
        return;
      }
    } else {
      state.plant.defuseProgress = Math.max(0, state.plant.defuseProgress - dt / DEFUSE_SECONDS);
    }
    if (state.fuseTime <= 0) {
      state.plant.state = 'detonated';
      endRound(state, fighters, state.attackers, 'Spike detonated');
      return;
    }
  } else {
    state.roundTime -= dt;
    if (state.roundTime <= 0) {
      endRound(state, fighters, state.attackers === TEAM.AMBER ? TEAM.VIOLET : TEAM.AMBER, 'Time expired — defenders hold');
      return;
    }
  }

  // elimination check
  const aAlive = aliveCount(fighters, TEAM.AMBER);
  const vAlive = aliveCount(fighters, TEAM.VIOLET);
  if (aAlive === 0 || vAlive === 0) {
    const winner = aAlive === 0 ? TEAM.VIOLET : TEAM.AMBER;
    endRound(state, fighters, winner, aAlive === 0 ? 'Amber team eliminated' : 'Violet team eliminated');
    return;
  }

  // spike pickup: a living attacker walking over a dropped spike takes it
  if (state.plant.state === 'dropped' && state.plant.droppedAt) {
    for (const f of fighters) {
      if (!f.alive || f.team !== state.attackers) continue;
      if (Math.hypot(f.pos.x - state.plant.droppedAt.x, f.pos.z - state.plant.droppedAt.z) < 1.1) {
        f.hasSpike = true;
        state.plant.state = 'idle';
        state.plant.droppedAt = null;
        state.plant.carrier = f.id;
        if (f.isPlayer) banner(state, 'SPIKE PICKED UP', 'Plant it at A or B with E');
        break;
      }
    }
  }

  // kill bonus for the player is paid at kill time in combat via stats; the
  // wallet top-up happens here so the HUD never shows a stale number.
  if (player.money !== state.playerMoney) state.playerMoney = player.money;
}

export function awardKill(state, killer) {
  if (!killer) return;
  killer.money += KILL_BONUS;
  if (killer.isPlayer) state.playerMoney = killer.money;
}
