// EMBERLINE — all sound is synthesised with WebAudio. No audio files ship
// with the game, so nothing is fetched and nothing can be a copyrighted asset.
let ctx = null;
let master = null;

export function ensureAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

function noiseBuffer(dur) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst(dur, filterFreq, type, gain, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const filt = ctx.createBiquadFilter();
  filt.type = type || 'lowpass';
  filt.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

function tone(freq, dur, type, gain, slideTo, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  shot(kind, dist) {
    if (!ctx) return;
    const vol = dist == null ? 1 : Math.max(0.08, 1 - dist / 60);
    if (kind === 'sniper') { burst(0.28, 900, 'lowpass', 0.9 * vol); tone(140, 0.18, 'sawtooth', 0.25 * vol, 60); }
    else if (kind === 'rifle') { burst(0.14, 1600, 'bandpass', 0.8 * vol); tone(180, 0.09, 'square', 0.18 * vol, 90); }
    else if (kind === 'smg') { burst(0.09, 2200, 'bandpass', 0.55 * vol); }
    else { burst(0.11, 1300, 'bandpass', 0.7 * vol); }
  },
  dryFire() { tone(1400, 0.05, 'square', 0.12); },
  reload() { tone(900, 0.05, 'square', 0.12); tone(600, 0.05, 'square', 0.12, null, 0.35); tone(1100, 0.06, 'square', 0.14, null, 0.8); },
  hit() { tone(2100, 0.05, 'sine', 0.25); },
  headshot() { tone(2600, 0.07, 'sine', 0.3); tone(3200, 0.08, 'sine', 0.25, null, 0.06); },
  hurt() { tone(220, 0.15, 'sawtooth', 0.2, 110); },
  step(run) { burst(0.05, 500, 'lowpass', run ? 0.12 : 0.07); },
  plantBeep() { tone(1200, 0.09, 'sine', 0.3); },
  spikeBeep(fast) { tone(fast ? 1600 : 1000, 0.08, 'sine', 0.22); },
  defuseBeep() { tone(900, 0.06, 'sine', 0.2); },
  roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.25, null, i * 0.12)); },
  roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.22, null, i * 0.14)); },
  buy() { tone(880, 0.08, 'triangle', 0.2); tone(1320, 0.1, 'triangle', 0.18, null, 0.07); },
  grenade() { burst(0.4, 800, 'lowpass', 0.4); },
  explosion() { burst(1.1, 300, 'lowpass', 1.0); tone(60, 0.9, 'sine', 0.5, 30); },
};
