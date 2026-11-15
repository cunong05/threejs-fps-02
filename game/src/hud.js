// EMBERLINE — HUD: one DOM update pass per rendered frame, driven only by
// state. The buy menu is a real shop (keys 1–5, click, or B to close) that
// only works during the buy phase.
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';
import { PHASE } from './state.js';

const $ = (id) => document.getElementById(id);

const fmtMoney = (n) => '$' + Math.floor(n).toLocaleString('en-US');
const fmtTime = (s) => {
  const v = Math.max(0, Math.ceil(s));
  return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
};

export function buildBuyMenu(onBuy) {
  const list = $('buy-list');
  const items = [
    { key: '1', id: 'smg', name: WEAPONS.smg.name, desc: 'Fast close-range spray · 32 rounds', price: WEAPONS.smg.price },
    { key: '2', id: 'rifle', name: WEAPONS.rifle.name, desc: 'Accurate, hard-hitting · 30 rounds', price: WEAPONS.rifle.price },
    { key: '3', id: 'sniper', name: WEAPONS.sniper.name, desc: 'One-shot body threat · 5 rounds', price: WEAPONS.sniper.price },
    { key: '4', id: 'grenade', name: GRENADE.name, desc: 'Mist that blocks enemy sight · max 2', price: GRENADE.price },
    { key: '5', id: 'armor', name: ARMOR.name, desc: 'Soaks half of each hit', price: ARMOR.price },
  ];
  for (const it of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.dataset.id = it.id;
    row.innerHTML = `<span class="buy-key">${it.key}</span><span class="buy-name">${it.name}</span><span class="buy-desc">${it.desc}</span><span class="buy-price">${fmtMoney(it.price)}</span>`;
    row.addEventListener('click', () => onBuy(it.id));
    list.appendChild(row);
  }
}

function teamAlive(fighters, team) {
  let n = 0;
  for (const f of fighters) if (f.alive && f.team === team) n += 1;
  return n;
}

export function updateHUD(state, fighters) {
  const p = fighters[0];
  if (!p) return;
  const w = WEAPONS[p.weapon];

  $('hp-num').textContent = Math.ceil(p.hp);
  $('hp-bar').style.width = Math.max(0, p.hp) + '%';
  $('hp-bar').classList.toggle('low', p.hp <= 30);
  $('armor-num').textContent = Math.ceil(p.armor);
  $('ammo-mag').textContent = p.mag;
  $('ammo-reserve').textContent = '/ ' + p.reserve;
  $('ammo').classList.toggle('empty', p.mag === 0);
  $('ammo').classList.toggle('reloading', p.reloading > 0);
  $('weapon-name').textContent = w.name + (p.reloading > 0 ? ' — reloading' : '');
  $('money-num').textContent = fmtMoney(state.playerMoney);
  $('score-amber').textContent = state.wins.amber;
  $('score-violet').textContent = state.wins.violet;
  $('round-num').textContent = 'ROUND ' + state.round + ' / ' + (state.firstTo * 2 - 1);
  $('alive-amber').textContent = teamAlive(fighters, 'amber');
  $('alive-violet').textContent = teamAlive(fighters, 'violet');
  $('timer').textContent = state.phase === PHASE.PLANTED
    ? '💥 ' + fmtTime(state.fuseTime)
    : state.phase === PHASE.BUY ? 'BUY ' + fmtTime(state.buyTime) : fmtTime(state.roundTime);
  $('timer').classList.toggle('danger', (state.phase === PHASE.PLANTED && state.fuseTime < 10) || (state.phase === PHASE.LIVE && state.roundTime < 15));

  // killfeed
  const feed = $('feed');
  const lines = state.feed.filter((l) => state.time - l.t < 6);
  if (feed.childElementCount !== lines.length || feed.dataset.first !== (lines[0] ? lines[0].text : '')) {
    feed.innerHTML = '';
    feed.dataset.first = lines[0] ? lines[0].text : '';
    for (const l of lines) {
      const d = document.createElement('div');
      d.textContent = l.text;
      feed.appendChild(d);
    }
  }

  // crosshair gap grows with spread: stopping to aim pays
  const spreadPx = 5 + (p.spreadBloom + (p.speed > 0.6 ? 0.02 : 0) + (p.onGround ? 0 : 0.03)) * 320;
  $('crosshair').style.setProperty('--gap', spreadPx.toFixed(1) + 'px');
  $('crosshair').classList.toggle('hidden', state.phase === PHASE.MENU || state.phase === PHASE.MATCH_END);

  // banner
  const showBanner = state.time < state.bannerUntil && state.banner;
  $('banner').hidden = !showBanner;
  if (showBanner) {
    $('banner-title').textContent = state.banner;
    $('banner-sub').textContent = state.bannerSub;
  }

  // spike / plant status line
  const sp = $('spike-line');
  if (state.plant.state === 'planted') {
    sp.hidden = false;
    sp.textContent = `SPIKE planted at ${state.plant.site} — ${fmtTime(state.fuseTime)} · defuse ${Math.round(state.plant.defuseProgress * 100)}%`;
  } else if (state.plant.state === 'planting') {
    sp.hidden = false;
    sp.textContent = `Planting spike… ${Math.round(state.plant.progress * 100)}%`;
  } else if (state.plant.state === 'dropped') {
    sp.hidden = false;
    sp.textContent = 'Spike dropped — walk over it to pick it up';
  } else if (p.hasSpike && (state.phase === PHASE.LIVE)) {
    sp.hidden = false;
    sp.textContent = 'You carry the spike — hold E inside A or B to plant';
  } else {
    sp.hidden = true;
  }

  // plant / defuse progress bar near the crosshair
  const prog = $('plant-progress');
  const active = (p.planting > 0 || p.defusing > 0) && (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED);
  prog.hidden = !active;
  if (active) {
    const frac = p.planting > 0 ? p.planting / 3 : p.defusing / 5;
    $('plant-fill').style.width = Math.min(100, frac * 100) + '%';
    $('plant-label').textContent = p.planting > 0 ? 'PLANTING' : 'DEFUSING';
  }

  // hitmarker flash
  if (state.hitAt && state.time - state.hitAt < 0.12) {
    $('hitmarker').classList.add('on');
    $('hitmarker').classList.toggle('kill', !!state.hitKill);
  } else {
    $('hitmarker').classList.remove('on', 'kill');
  }

  // buy menu visibility + affordability
  const buy = $('buy-menu');
  const open = state.phase === PHASE.BUY && state.buyOpen;
  buy.hidden = !open;
  if (open) {
    $('buy-money').textContent = fmtMoney(state.playerMoney);
    $('buy-time').textContent = fmtTime(state.buyTime);
    for (const row of buy.querySelectorAll('.buy-row')) {
      const id = row.dataset.id;
      const price = id === 'grenade' ? GRENADE.price : id === 'armor' ? ARMOR.price : WEAPONS[id].price;
      row.classList.toggle('cant', state.playerMoney < price);
      row.classList.toggle('owned', id === p.weapon);
    }
  }

  // smoke indicator
  $('smoke-note').hidden = !(state.smokes.length > 0);
}
