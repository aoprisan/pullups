import { PullupTimer, type ViewState, type Phase } from "./timer";
import { beepCountdown, beepRepCue, beepDone, unlockAudio } from "./audio";

const REP_OPTIONS = [10, 20] as const;
const DEFAULT_REPS = 20;
const INTERVAL_MS = 60_000;

let currentReps: number = loadReps();
let timer = new PullupTimer({
  totalReps: currentReps,
  intervalMs: INTERVAL_MS,
});

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="title">
    <strong>Pullups</strong>
    <span id="modeLabel">${modeLabel(currentReps)}</span>
  </header>

  <section class="seg" role="radiogroup" aria-label="Total reps" id="repSelector">
    ${REP_OPTIONS.map(
      (n) =>
        `<button type="button" role="radio" data-reps="${n}" aria-checked="${n === currentReps}">${n}</button>`,
    ).join("")}
  </section>

  <section class="rep-display">
    <div class="big" id="big">1<span class="of"> / ${currentReps}</span></div>
    <div class="label" id="phaseLabel">Ready</div>
  </section>

  <section class="dots" id="dots" aria-label="Rep progression"></section>

  <section class="rest-card" id="restCard">
    <div class="rest-row">
      <span class="label" id="restLabel">Ready when you are</span>
      <span class="value" id="restTime"></span>
    </div>
    <div class="bar" id="restBarWrap"><div id="restFill" style="width:0%"></div></div>
  </section>

  <section class="meta-line">
    <span class="label">Elapsed</span>
    <span class="value" id="elapsed">0:00</span>
  </section>

  <section class="controls">
    <button class="primary" id="primaryBtn">Start</button>
    <button class="secondary" id="resetBtn">Reset</button>
  </section>
`;

const dotsEl = byId("dots");
const bigEl = byId("big");
const phaseLabelEl = byId("phaseLabel");
const restLabelEl = byId("restLabel");
const restTimeEl = byId("restTime");
const restBarWrapEl = byId("restBarWrap");
const restFillEl = byId("restFill");
const elapsedEl = byId("elapsed");
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
  const now = performance.now();
  switch (timer.currentPhase) {
    case "idle":
    case "done":
      timer.start(now);
      beepRepCue();
      break;
    case "ready":
      timer.repDone(now);
      if (timer.completedReps >= currentReps) {
        setTimeout(beepDone, 80);
      }
      break;
    case "resting":
      timer.pause(now);
      break;
    case "paused":
      timer.resume(now);
      break;
  }
});

resetBtn.addEventListener("click", () => {
  timer.reset();
});

function frame(now: number) {
  const view = timer.tick(now);
  render(view);
  if (view.newRestCountdownTickIndex !== null) {
    beepCountdown();
  }
  if (view.newRepReadyIndex !== null) {
    beepRepCue();
    pulseBig();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setReps(n: number) {
  currentReps = n;
  saveReps(n);
  timer = new PullupTimer({
    totalReps: currentReps,
    intervalMs: INTERVAL_MS,
  });
  modeLabelEl.textContent = modeLabel(currentReps);
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
  const displayRep = v.phase === "idle" ? 1 : v.currentRepNumber;
  bigEl.innerHTML = `${displayRep}<span class="of"> / ${currentReps}</span>`;
  bigEl.classList.toggle("done", v.phase === "done");

  phaseLabelEl.textContent = phaseLabel(v);

  applyRestCard(v);

  elapsedEl.textContent = formatClock(v.totalElapsedMs);

  renderDots(v.repsCompleted, v.currentRepNumber, v.phase);
  syncRepSelector();

  primaryBtn.classList.toggle("paused", v.phase === "paused");
  primaryBtn.classList.toggle("ready", v.phase === "ready");
  primaryBtn.textContent = primaryLabel(v.phase);
  resetBtn.disabled = v.phase === "idle";
}

function applyRestCard(v: ViewState) {
  if (v.phase === "resting" || v.phase === "paused") {
    restLabelEl.textContent = v.phase === "paused" ? "Paused" : `Rest before rep ${v.currentRepNumber}`;
    restTimeEl.textContent = formatClock(v.secondsRemainingInRest * 1000);
    restBarWrapEl.style.display = "block";
    const pct = Math.min(100, (v.restElapsedMs / v.restTotalMs) * 100);
    restFillEl.style.width = `${pct}%`;
    return;
  }

  restBarWrapEl.style.display = "none";
  restTimeEl.textContent = "";
  restFillEl.style.width = "0%";

  if (v.phase === "idle") {
    restLabelEl.textContent = "Ready when you are";
  } else if (v.phase === "ready") {
    restLabelEl.textContent = `Do rep ${v.currentRepNumber} — tap when done`;
  } else if (v.phase === "done") {
    restLabelEl.textContent = "Workout complete";
  }
}

function phaseLabel(v: ViewState): string {
  switch (v.phase) {
    case "idle":
      return "Ready";
    case "ready":
      return `On rep ${v.currentRepNumber}`;
    case "resting":
      return "Resting";
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
    case "ready":
      return "Pullup done";
    case "resting":
      return "Pause";
    case "paused":
      return "Resume";
    case "done":
      return "Restart";
  }
}

function modeLabel(reps: number): string {
  return `${reps} reps · 1 min rest`;
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
  const highlight = phase === "ready" || phase === "resting" || phase === "paused";
  for (let i = 0; i < currentReps; i++) {
    const el = children[i] as HTMLElement;
    el.classList.toggle("filled", i < filledCount);
    el.classList.toggle("current", highlight && i === currentRep - 1 && filledCount < currentReps);
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
    // localStorage unavailable — fall through
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
