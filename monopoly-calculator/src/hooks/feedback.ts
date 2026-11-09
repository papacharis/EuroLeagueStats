import type { Feedback } from '../engine/keypad';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.05) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Piezo-style beeps (synthesised – the original unit's sounds are not documented). */
export function playFeedback(f: Feedback) {
  if (f === 'key') tone(2400, 0, 0.035);
  else if (f === 'ok') {
    tone(1800, 0, 0.06);
    tone(2700, 0.07, 0.09);
  } else {
    tone(320, 0, 0.12, 'sawtooth', 0.06);
    tone(260, 0.14, 0.18, 'sawtooth', 0.06);
  }
}

export function vibrate(f: Feedback) {
  try {
    navigator.vibrate?.(f === 'error' ? [40, 40, 60] : f === 'ok' ? 25 : 10);
  } catch {
    /* not supported */
  }
}
