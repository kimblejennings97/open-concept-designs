/** Tiny synthesized sound effects (Web Audio, no files). Muted state is remembered per browser. */
type Cue = 'place' | 'draw' | 'remove' | 'error' | 'success' | 'fail' | 'click';

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('ocd.muted') === '1';
  } catch {
    return false;
  }
})();

export const isMuted = (): boolean => muted;

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem('ocd.muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(a: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, slideTo?: number) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function play(cue: Cue): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  switch (cue) {
    case 'place':
      tone(a, 520, t, 0.09, 'triangle', 0.09);
      tone(a, 780, t + 0.05, 0.08, 'triangle', 0.06);
      break;
    case 'draw':
      tone(a, 340, t, 0.07, 'square', 0.035, 420);
      break;
    case 'remove':
      tone(a, 420, t, 0.12, 'triangle', 0.07, 220);
      break;
    case 'click':
      tone(a, 900, t, 0.03, 'square', 0.025);
      break;
    case 'error':
      tone(a, 180, t, 0.18, 'sawtooth', 0.05, 140);
      break;
    case 'success':
      [523, 659, 784, 1047].forEach((f, i) => tone(a, f, t + i * 0.09, 0.22, 'triangle', 0.08));
      break;
    case 'fail':
      [392, 330, 262].forEach((f, i) => tone(a, f, t + i * 0.12, 0.25, 'triangle', 0.07));
      break;
  }
}
