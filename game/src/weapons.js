// EMBERLINE — weapon definitions. One table drives the HUD, the buy menu,
// the sim's damage model and the viewmodel. All damage is hitscan.
export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm',
    kind: 'pistol',
    price: 0,
    damage: 30,
    headMul: 2.2,
    legMul: 0.75,
    mag: 12,
    reserve: 48,
    reserveMax: 96,
    rate: 0.16, // seconds between shots
    reload: 1.1,
    auto: false,
    spread: 0.011, // radians, standing still
    moveSpread: 0.030,
    airSpread: 0.05,
    bloom: 0.004, // extra spread per shot in a burst
    recoil: 0.011, // pitch kick per shot (radians)
    kick: 0.010, // viewmodel kick
    range: 90,
    tracer: 0xffd27a,
  },
  smg: {
    name: 'Hornet-9',
    kind: 'smg',
    price: 1500,
    damage: 22,
    headMul: 2.0,
    legMul: 0.8,
    mag: 32,
    reserve: 96,
    reserveMax: 192,
    rate: 0.075,
    reload: 1.9,
    auto: true,
    spread: 0.016,
    moveSpread: 0.038,
    airSpread: 0.06,
    bloom: 0.0035,
    recoil: 0.008,
    kick: 0.014,
    range: 70,
    tracer: 0xffe9a8,
  },
  rifle: {
    name: 'VK-47 Longshot',
    kind: 'rifle',
    price: 2700,
    damage: 36,
    headMul: 2.5,
    legMul: 0.75,
    mag: 30,
    reserve: 90,
    reserveMax: 180,
    rate: 0.115,
    reload: 2.4,
    auto: true,
    spread: 0.006,
    moveSpread: 0.034,
    airSpread: 0.055,
    bloom: 0.0045,
    recoil: 0.016,
    kick: 0.022,
    range: 120,
    tracer: 0xffc46b,
  },
  sniper: {
    name: 'Dune Lance',
    kind: 'sniper',
    price: 3800,
    damage: 88,
    headMul: 2.0,
    legMul: 0.7,
    mag: 5,
    reserve: 15,
    reserveMax: 30,
    rate: 1.15,
    reload: 3.1,
    auto: false,
    spread: 0.0015,
    moveSpread: 0.075,
    airSpread: 0.09,
    bloom: 0.01,
    recoil: 0.05,
    kick: 0.05,
    range: 160,
    tracer: 0x9fd8ff,
  },
};

export const GRENADE = { name: 'Mist Grenade', price: 300, max: 2 };
export const ARMOR = { name: 'Kevlar Vest', price: 650 };

export function weaponOf(f) {
  return WEAPONS[f.weapon];
}

// Give a fighter a weapon: full mag, fresh reserve, no reload in progress.
export function equip(f, key) {
  const w = WEAPONS[key];
  f.weapon = key;
  f.mag = w.mag;
  f.reserve = w.reserve;
  f.reloading = 0;
  f.burst = 0;
  f.spreadBloom = 0;
}

// Armor soaks 50% of a hit until it runs out.
export function applyDamage(target, raw, zone) {
  const wMul = zone === 'head' ? 2 : zone === 'leg' ? 0.75 : 1;
  let dmg = raw * wMul;
  if (target.armor > 0) {
    const soaked = Math.min(target.armor, dmg * 0.5);
    target.armor -= soaked;
    dmg -= soaked;
  }
  target.hp -= dmg;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
  }
  return dmg;
}
