type Ctx = AudioContext;

let ctx: Ctx | null = null;

function getCtx(): Ctx | null {
  if (ctx) return ctx;
  const C =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  return ctx;
}

export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") {
    void c.resume();
  }
}

function tone(freq: number, durationMs: number, gain: number): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();

  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;

  const now = c.currentTime;
  const dur = durationMs / 1000;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.01);
  g.gain.linearRampToValueAtTime(0, now + dur);

  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

export function beepCountdown(): void {
  tone(440, 120, 0.15);
}

export function beepRepCue(): void {
  tone(880, 90, 0.22);
  setTimeout(() => tone(1320, 140, 0.22), 110);
}

export function beepDone(): void {
  tone(660, 180, 0.2);
  setTimeout(() => tone(880, 180, 0.2), 200);
  setTimeout(() => tone(1320, 320, 0.22), 400);
}
