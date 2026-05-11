import { EmomTimer, type ViewState, type Phase } from "./timer";
import { beepCountdown, beepRepCue, beepDone, unlockAudio } from "./audio";

const TOTAL_REPS = 20;
const INTERVAL_MS = 60_000;
const COUNTDOWN_MS = 5_000;

const timer = new EmomTimer({
  totalReps: TOTAL_REPS,
  intervalMs: INTERVAL_MS,
  countdownMs: COUNTDOWN_MS,
});

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="title">
    <strong>Pullups</strong>
    <span>EMOM · 20 reps · 1 min</span>
  </header>

  <section class="rep-display">
    <div class="big" id="big">0<span class="of"> / ${TOTAL_REPS}</span></div>
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
      <span id="total">${formatClock((TOTAL_REPS - 1) * INTERVAL_MS)}</span>
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
const primaryBtn = byId("primaryBtn") as HTMLButtonElement;
const resetBtn = byId("resetBtn") as HTMLButtonElement;

renderDots(0, 0, "idle");

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
    if (view.newRepCueIndex >= TOTAL_REPS) {
      setTimeout(beepDone, 200);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function render(v: ViewState) {
  if (v.phase === "countdown" || (v.phase === "paused" && v.countdownSecondsRemaining > 0)) {
    bigEl.textContent = String(v.countdownSecondsRemaining);
    bigEl.classList.add("countdown");
    bigEl.classList.remove("done");
  } else if (v.phase === "done") {
    bigEl.innerHTML = `${TOTAL_REPS}<span class="of"> / ${TOTAL_REPS}</span>`;
    bigEl.classList.add("done");
    bigEl.classList.remove("countdown");
  } else {
    bigEl.innerHTML = `${v.repsCued}<span class="of"> / ${TOTAL_REPS}</span>`;
    bigEl.classList.remove("countdown", "done");
  }

  phaseLabelEl.textContent = phaseLabel(v.phase, v.repsCued);

  if (v.phase === "countdown" || (v.phase === "paused" && v.countdownSecondsRemaining > 0)) {
    nextRepEl.textContent = `Rep 1 in ${v.countdownSecondsRemaining}s`;
  } else if (v.phase === "done") {
    nextRepEl.textContent = "Workout complete";
  } else if (v.repsCued >= TOTAL_REPS) {
    nextRepEl.textContent = "Last rep — finish strong";
  } else if (v.phase === "idle") {
    nextRepEl.textContent = "—";
  } else {
    nextRepEl.textContent = formatClock(v.secondsToNextRep * 1000);
  }

  const pct = v.totalMs === 0 ? 0 : Math.min(100, (v.elapsedMs / v.totalMs) * 100);
  progressFillEl.style.width = `${pct}%`;
  elapsedEl.textContent = formatClock(v.elapsedMs);

  renderDots(v.repsCued, v.phase === "done" ? TOTAL_REPS : v.repsCued, v.phase);

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
  if (dotsEl.childElementCount !== TOTAL_REPS) {
    dotsEl.innerHTML = "";
    for (let i = 0; i < TOTAL_REPS; i++) {
      const d = document.createElement("div");
      d.className = "dot";
      d.setAttribute("aria-label", `Rep ${i + 1}`);
      dotsEl.appendChild(d);
    }
  }
  const children = dotsEl.children;
  for (let i = 0; i < TOTAL_REPS; i++) {
    const el = children[i] as HTMLElement;
    el.classList.toggle("filled", i < filledCount);
    el.classList.toggle(
      "current",
      phase === "running" && i === currentRep - 1 && currentRep < TOTAL_REPS,
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
