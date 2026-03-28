const ctx = typeof window !== "undefined" ? new (window.AudioContext || window.webkitAudioContext)() : null;

function beep(freq = 440, duration = 0.3, gain = 0.3) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.connect(g);
  g.connect(ctx.destination);
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

export function playFocusStart() { beep(528, 0.4, 0.25); }
export function playBreakStart() { beep(396, 0.5, 0.2); }
