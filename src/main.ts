import { EmomTimer, type ViewState, type Phase } from "./timer";
import { beepCountdown, beepRepCue, beepDone, unlockAudio } from "./audio";

const REP_OPTIONS = [10, 20] as const;
const DEFAULT_REPS = 20;
const INTERVAL_MS = 60_000;
const COUNTDOWN_MS = 5_000;

let currentReps: number = loadReps();
let timer = new EmomTimer({
  totalReps: currentReps,
  intervalMs: INTERVAL_MS,
  countdownMs: COUNTDOWN_MS,
});

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="title">
    <strong>Pullups</strong>
    <span id="modeLabel">EMOM · ${currentReps} reps · 1 min</span>
  </header>

  <section class="seg" role="radiogroup" aria-label="Total reps" id="repSelector">
    ${REP_OPTIONS.map(
      (n) =>
        `<button type="button" role="radio" data-reps="${n}" aria-checked="${n === currentReps}">${n}</button>`,
    ).join("")}
  </section>

  <section class="rep-display">
    <div class="big" id="big">0<span class="of"> / ${currentReps}</span></div>
    <div class="label" id="phaseLabel">Ready</div>
  </section>

  <section class="dots" id="dots" aria-label="Rep progression"></section>

  <section class="next-rep">
    <span class="label">Next rep</span>
    <span class="value" id="nextRep">—</span>
  </section>

  <section class="progress">
    <div class="bar"><div id="progressFill" style="width:0%"></div></div>
    <div class="meta">
      <span id="elapsed">0:00</span>
      <span id="total">${formatClock((currentReps - 1) * INTERVAL_MS)}</span>
    </div>
  </section>

  <section class="controls">
    <button class="primary" id="primaryBtn">Start</button>
    <button class="secondary" id="resetBtn">Reset</button>
  </section>
`;

const dotsEl = byId("dots");
const bigEl = byId("big");
const phaseLabelEl = byId("phaseLabel");
const nextRepEl = byId("nextRep");
const progressFillEl = byId("progressFill");
const elapsedEl = byId("elapsed");
const totalEl = byId("total");
const modeLabelEl = byId("modeLabel");
const repSelectorEl = byId("repSelector");
const primaryBtn = byId("primaryBtn") as HTMLButtonElement;
const resetBtn = byId("resetBtn") as HTMLButtonElement;

renderDots(0, 0, "idle");

repSelectorEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-reps]");
  if (!btn || btn.disabled) return;
  const next = Number(btn.dataset.reps);
  if (!REP_OPTIONS.includes(next as (typeof REP_OPTIONS)[number])) return;
  if (next === currentReps) return;
  if (!canChangeReps()) return;
  setReps(next);
});

primaryBtn.addEventListener("click", () => {
  unlockAudio();
  const phase = timer.currentPhase;
  const now = performance.now();
  if (phase === "idle" || phase === "done") {
    timer.start(now);
  } else if (phase === "paused") {
    timer.resume(now);
  } else {
    timer.pause(now);
  }
});

resetBtn.addEventListener("click", () => {
  timer.reset();
});

function frame(now: number) {
  const view = timer.tick(now);
  render(view);
  if (view.newCountdownTickIndex !== null) {
    if (view.countdownSecondsRemaining > 0) {
      beepCountdown();
    }
  }
  if (view.newRepCueIndex !== null) {
    beepRepCue();
    pulseBig();
    if (view.newRepCueIndex >= currentReps) {
      setTimeout(beepDone, 200);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setReps(n: number) {
  currentReps = n;
  saveReps(n);
  timer = new EmomTimer({
    totalReps: currentReps,
    intervalMs: INTERVAL_MS,
    countdownMs: COUNTDOWN_MS,
  });
  modeLabelEl.textContent = `EMOM · ${currentReps} reps · 1 min`;
  totalEl.textContent = formatClock((currentReps - 1) * INTERVAL_MS);
  syncRepSelector();
  renderDots(0, 0, "idle");
}

function canChangeReps(): boolean {
  const p = timer.currentPhase;
  return p === "idle" || p === "done";
}

function syncRepSelector() {
  const canChange = canChangeReps();
  for (const btn of repSelectorEl.querySelectorAll<HTMLButtonElement>("button[data-reps]")) {
    const n = Number(btn.dataset.reps);
    const selected = n === currentReps;
    btn.setAttribute("aria-checked", String(selected));
    btn.classList.toggle("active", selected);
    btn.disabled = !canChange;
  }
}

function render(v: ViewState) {
  if (v.phase === "countdown" || (v.phase === "paused" && v.countdownSecondsRemaining > 0)) {
    bigEl.textContent = String(v.countdownSecondsRemaining);
    bigEl.classList.add("countdown");
    bigEl.classList.remove("done");
  } else if (v.phase === "done") {
    bigEl.innerHTML = `${currentReps}<span class="of"> / ${currentReps}</span>`;
    bigEl.classList.add("done");
    bigEl.classList.remove("countdown");
  } else {
    bigEl.innerHTML = `${v.repsCued}<span class="of"> / ${currentReps}</span>`;
    bigEl.classList.remove("countdown", "done");
  }

  phaseLabelEl.textContent = phaseLabel(v.phase, v.repsCued);

  if (v.phase === "countdown" || (v.phase === "paused" && v.countdownSecondsRemaining > 0)) {
    nextRepEl.textContent = `Rep 1 in ${v.countdownSecondsRemaining}s`;
  } else if (v.phase === "done") {
    nextRepEl.textContent = "Workout complete";
  } else if (v.repsCued >= currentReps) {
    nextRepEl.textContent = "Last rep — finish strong";
  } else if (v.phase === "idle") {
    nextRepEl.textContent = "—";
  } else {
    nextRepEl.textContent = formatClock(v.secondsToNextRep * 1000);
  }

  const pct = v.totalMs === 0 ? 0 : Math.min(100, (v.elapsedMs / v.totalMs) * 100);
  progressFillEl.style.width = `${pct}%`;
  elapsedEl.textContent = formatClock(v.elapsedMs);

  renderDots(v.repsCued, v.phase === "done" ? currentReps : v.repsCued, v.phase);
  syncRepSelector();

  primaryBtn.classList.toggle("paused", v.phase === "paused");
  primaryBtn.textContent = primaryLabel(v.phase);
  resetBtn.disabled = v.phase === "idle";
}

function phaseLabel(phase: Phase, repsCued: number): string {
  switch (phase) {
    case "idle":
      return "Ready";
    case "countdown":
      return "Get ready…";
    case "running":
      return repsCued === 0 ? "Get ready…" : `On rep ${repsCued}`;
    case "paused":
      return "Paused";
    case "done":
      return "Done — nice work";
  }
}

function primaryLabel(phase: Phase): string {
  switch (phase) {
    case "idle":
      return "Start";
    case "countdown":
    case "running":
      return "Pause";
    case "paused":
      return "Resume";
    case "done":
      return "Restart";
  }
}

function renderDots(filledCount: number, currentRep: number, phase: Phase) {
  if (dotsEl.childElementCount !== currentReps) {
    dotsEl.innerHTML = "";
    for (let i = 0; i < currentReps; i++) {
      const d = document.createElement("div");
      d.className = "dot";
      d.setAttribute("aria-label", `Rep ${i + 1}`);
      dotsEl.appendChild(d);
    }
  }
  const children = dotsEl.children;
  for (let i = 0; i < currentReps; i++) {
    const el = children[i] as HTMLElement;
    el.classList.toggle("filled", i < filledCount);
    el.classList.toggle(
      "current",
      phase === "running" && i === currentRep - 1 && currentRep < currentReps,
    );
  }
}

function pulseBig() {
  bigEl.classList.remove("pulse");
  void bigEl.offsetWidth;
  bigEl.classList.add("pulse");
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

function loadReps(): number {
  try {
    const raw = localStorage.getItem("pullups.reps");
    const n = raw === null ? NaN : Number(raw);
    if (REP_OPTIONS.includes(n as (typeof REP_OPTIONS)[number])) return n;
  } catch {
    // localStorage unavailable — fall through to default
  }
  return DEFAULT_REPS;
}

function saveReps(n: number) {
  try {
    localStorage.setItem("pullups.reps", String(n));
  } catch {
    // ignore
  }
}
