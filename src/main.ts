import { registerSW } from "virtual:pwa-register";
import { PullupTimer, type ViewState, type Phase } from "./timer";
import { beepCountdown, beepRepCue, beepDone, unlockAudio } from "./audio";

const REP_OPTIONS = [10, 20] as const;
const DEFAULT_REPS = 20;
const INTERVAL_MS = 60_000;
const DIAL_PATH_LENGTH = 100;
const SVG_NS = "http://www.w3.org/2000/svg";

let currentReps: number = loadReps();
let timer = new PullupTimer({
  totalReps: currentReps,
  intervalMs: INTERVAL_MS,
});

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="masthead">
    <div class="masthead-row">
      <h1>PULL<span class="accent">·</span>UPS</h1>
      <div class="masthead-stamp">LOG&nbsp;N°&nbsp;001</div>
    </div>
    <div class="masthead-sub" id="modeLabel">${modeLabel(currentReps)}</div>
    <div class="hatching" aria-hidden="true"></div>
  </header>

  <section class="seg" role="radiogroup" aria-label="Total reps" id="repSelector">
    ${REP_OPTIONS.map(
      (n) =>
        `<button type="button" role="radio" data-reps="${n}" aria-checked="${n === currentReps}">${pad2(n)} REPS</button>`,
    ).join("")}
  </section>

  <div class="dial-stage">
    <svg class="dial" id="dial" viewBox="0 0 340 340" aria-hidden="true">
      <defs>
        <radialGradient id="dialFace" cx="50%" cy="40%" r="66%">
          <stop offset="0%" stop-color="#f4eddc" />
          <stop offset="58%" stop-color="#e9dec3" />
          <stop offset="100%" stop-color="#d6c79f" />
        </radialGradient>
        <filter id="dialEmboss" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#15110d" flood-opacity="0.17" />
        </filter>
      </defs>
      <circle class="dial-face" cx="170" cy="170" r="154" fill="url(#dialFace)" filter="url(#dialEmboss)" />
      <circle class="dial-rim" cx="170" cy="170" r="154" />
      <g class="dial-ticks" id="dialTicks"></g>
      <g class="dial-numerals" id="dialNumerals"></g>
      <circle class="dial-track" cx="170" cy="170" r="138" />
      <circle
        class="dial-fill idle"
        id="dialFill"
        cx="170"
        cy="170"
        r="138"
        pathLength="${DIAL_PATH_LENGTH}"
        stroke-dasharray="${DIAL_PATH_LENGTH} ${DIAL_PATH_LENGTH}"
        stroke-dashoffset="${DIAL_PATH_LENGTH}"
      />
    </svg>
    <div class="dial-center" id="dialCenter">
      <div class="eyebrow" id="eyebrow">READY</div>
      <div class="big-number" id="big">${pad2(1)}</div>
      <div class="big-number-of" id="bigOf">of ${pad2(currentReps)}</div>
      <div class="dial-status" id="dialStatus">PRESS START</div>
    </div>
  </div>

  <section class="tally" id="tally" aria-label="Rep progression"></section>

  <div class="meta">
    <span class="meta-label">Elapsed</span>
    <span class="meta-value" id="elapsed">0:00</span>
  </div>

  <div class="controls">
    <button class="primary idle" id="primaryBtn">START</button>
    <button class="secondary" id="resetBtn">Reset workout</button>
    <button class="secondary update" id="updateBtn" data-state="idle">Update app</button>
    <div class="build-stamp" id="buildStamp"></div>
  </div>
`;

const dialEl = byId("dial");
const dialFillEl = byId("dialFill") as unknown as SVGCircleElement;
const dialCenterEl = byId("dialCenter");
const eyebrowEl = byId("eyebrow");
const bigEl = byId("big");
const bigOfEl = byId("bigOf");
const dialStatusEl = byId("dialStatus");
const tallyEl = byId("tally");
const elapsedEl = byId("elapsed");
const modeLabelEl = byId("modeLabel");
const repSelectorEl = byId("repSelector");
const primaryBtn = byId("primaryBtn") as HTMLButtonElement;
const resetBtn = byId("resetBtn") as HTMLButtonElement;
const updateBtn = byId("updateBtn") as HTMLButtonElement;
const buildStampEl = byId("buildStamp");

buildDialDecorations();
renderTally(0);
renderBuildStamp();

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
      pulseBig();
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

// ───────────────────────── APP UPDATES ─────────────────────────
// We register the service worker ourselves (importing virtual:pwa-register
// tells the plugin to skip its auto-injected registration) so updates flow
// through the "Update app" button instead of reloading the page from under
// you. In autoUpdate mode the new worker has already taken control by the
// time onNeedReload fires, so a plain reload is enough to pick up new assets.
type UpdateState = "idle" | "checking" | "current" | "ready" | "updating";

const UPDATE_LABELS: Record<UpdateState, string> = {
  idle: "Update app",
  checking: "Checking…",
  current: "Up to date",
  ready: "Update ready · tap",
  updating: "Updating…",
};

let swRegistration: ServiceWorkerRegistration | undefined;
let userRequestedUpdate = false;
let revertTimer: number | undefined;

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    swRegistration = registration;
  },
  onNeedReload() {
    // A newer version has activated. If the user asked for it, apply it now;
    // otherwise just surface it so we never interrupt a workout in progress.
    if (userRequestedUpdate) reloadForUpdate();
    else setUpdateState("ready");
  },
});

updateBtn.addEventListener("click", async () => {
  const state = updateBtn.dataset.state;
  if (state === "ready") {
    // Update was detected in the background — apply it on demand.
    reloadForUpdate();
    return;
  }
  if (state === "checking" || state === "updating") return;

  userRequestedUpdate = true;
  setUpdateState("checking");

  if (!swRegistration) {
    // No service worker yet — a plain reload is the best we can do.
    window.location.reload();
    return;
  }
  try {
    await swRegistration.update();
    // If a new worker is downloading/activating, onNeedReload reloads the page.
    // Otherwise we're already on the latest build.
    if (!swRegistration.installing && !swRegistration.waiting) {
      userRequestedUpdate = false;
      setUpdateState("current");
    }
  } catch {
    userRequestedUpdate = false;
    setUpdateState("idle");
  }
});

function setUpdateState(state: UpdateState) {
  if (revertTimer !== undefined) {
    clearTimeout(revertTimer);
    revertTimer = undefined;
  }
  updateBtn.dataset.state = state;
  updateBtn.textContent = UPDATE_LABELS[state];
  if (state === "current") {
    revertTimer = window.setTimeout(() => setUpdateState("idle"), 2500);
  }
}

function reloadForUpdate() {
  setUpdateState("updating");
  window.location.reload();
}

function renderBuildStamp() {
  const date = new Date(__BUILD_TIME__);
  if (Number.isNaN(date.getTime())) {
    buildStampEl.textContent = "";
    return;
  }
  const stamp = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  buildStampEl.textContent = `Build · ${stamp}`;
  buildStampEl.title = date.toISOString();
}

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
  bigOfEl.textContent = `of ${pad2(currentReps)}`;
  renderTally(0);
  syncRepSelector();
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
  const isRestState = v.phase === "resting" || v.phase === "paused";

  if (isRestState) {
    bigEl.textContent = formatClock(v.secondsRemainingInRest * 1000);
    bigEl.classList.add("timer");
    bigEl.classList.remove("done-state");
    bigOfEl.style.visibility = "hidden";
  } else {
    bigEl.textContent = pad2(displayRepNumber(v));
    bigEl.classList.remove("timer");
    bigEl.classList.toggle("done-state", v.phase === "done");
    bigOfEl.style.visibility = "visible";
  }

  eyebrowEl.textContent = eyebrowLabel(v);
  dialStatusEl.textContent = statusLabel(v);

  applyDialFill(v);

  elapsedEl.textContent = formatClock(v.totalElapsedMs);

  renderTally(v.repsCompleted);
  highlightCurrentTally(v);
  syncRepSelector();

  primaryBtn.className = `primary ${v.phase}`;
  primaryBtn.textContent = primaryLabel(v.phase);
  resetBtn.disabled = v.phase === "idle";
}

function displayRepNumber(v: ViewState): number {
  if (v.phase === "idle") return 1;
  if (v.phase === "done") return currentReps;
  return v.currentRepNumber;
}

function eyebrowLabel(v: ViewState): string {
  switch (v.phase) {
    case "idle":
      return "READY";
    case "ready":
      return "REP";
    case "resting":
      return "REST";
    case "paused":
      return "PAUSED";
    case "done":
      return "DONE";
  }
}

function statusLabel(v: ViewState): string {
  switch (v.phase) {
    case "idle":
      return "PRESS START";
    case "ready":
      return v.currentRepNumber >= currentReps
        ? "LAST ONE · TAP WHEN DONE"
        : "TAP WHEN PULLUP DONE";
    case "resting":
      return `NEXT · REP ${pad2(v.currentRepNumber)}`;
    case "paused":
      return `RESUME · REP ${pad2(v.currentRepNumber)} NEXT`;
    case "done":
      return "NICE WORK";
  }
}

function primaryLabel(phase: Phase): string {
  switch (phase) {
    case "idle":
      return "START";
    case "ready":
      return "PULLUP DONE";
    case "resting":
      return "PAUSE";
    case "paused":
      return "RESUME";
    case "done":
      return "RESTART";
  }
}

function modeLabel(reps: number): string {
  return `${pad2(reps)} reps · 60 second rest · one minute on the minute`;
}

function applyDialFill(v: ViewState) {
  const fill = dialFillEl;
  fill.classList.remove("idle", "ready", "resting", "paused", "done");
  fill.classList.add(v.phase);

  if (v.phase === "resting" || v.phase === "paused") {
    const restRemaining = Math.max(0, v.restTotalMs - v.restElapsedMs);
    const remainingFraction = restRemaining / v.restTotalMs;
    const offset = (1 - remainingFraction) * DIAL_PATH_LENGTH;
    fill.setAttribute("stroke-dashoffset", offset.toFixed(2));
  } else {
    fill.setAttribute("stroke-dashoffset", DIAL_PATH_LENGTH.toString());
  }
}

function pulseBig() {
  dialCenterEl.classList.remove("pulse-now");
  void dialCenterEl.offsetWidth;
  dialCenterEl.classList.add("pulse-now");
}

function buildDialDecorations() {
  const ticksGroup = byId("dialTicks");
  const numeralsGroup = byId("dialNumerals");
  const cx = 170;
  const cy = 170;

  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const isMajor = i % 5 === 0;
    const inner = isMajor ? 156 : 160;
    const outer = isMajor ? 170 : 166;
    const x1 = cx + Math.cos(angle) * inner;
    const y1 = cy + Math.sin(angle) * inner;
    const x2 = cx + Math.cos(angle) * outer;
    const y2 = cy + Math.sin(angle) * outer;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x1.toFixed(2));
    line.setAttribute("y1", y1.toFixed(2));
    line.setAttribute("x2", x2.toFixed(2));
    line.setAttribute("y2", y2.toFixed(2));
    line.setAttribute("class", `dial-tick${isMajor ? " major" : ""}`);
    ticksGroup.appendChild(line);
  }

  const numerals: Array<{ at: number; label: string }> = [
    { at: 0, label: "60" },
    { at: 15, label: "15" },
    { at: 30, label: "30" },
    { at: 45, label: "45" },
  ];
  for (const { at, label } of numerals) {
    const angle = (at / 60) * Math.PI * 2 - Math.PI / 2;
    const r = 145;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", x.toFixed(2));
    text.setAttribute("y", y.toFixed(2));
    text.setAttribute("class", "dial-numeral");
    text.textContent = label;
    numeralsGroup.appendChild(text);
  }

  void dialEl;
}

function renderTally(filledCount: number) {
  const groupCount = currentReps / 5;
  if (tallyEl.childElementCount !== groupCount) {
    tallyEl.innerHTML = "";
    for (let g = 0; g < groupCount; g++) {
      const group = document.createElement("div");
      group.className = "tally-group";
      for (let s = 0; s < 4; s++) {
        const stroke = document.createElement("div");
        stroke.className = "stroke";
        group.appendChild(stroke);
      }
      const slash = document.createElement("div");
      slash.className = "slash";
      group.appendChild(slash);
      tallyEl.appendChild(group);
    }
  }

  const groups = tallyEl.children;
  for (let g = 0; g < groupCount; g++) {
    const group = groups[g] as HTMLElement;
    const base = g * 5;
    const children = group.children;
    for (let s = 0; s < 4; s++) {
      (children[s] as HTMLElement).classList.toggle("filled", base + s < filledCount);
    }
    (children[4] as HTMLElement).classList.toggle("filled", base + 4 < filledCount);
  }
}

function highlightCurrentTally(v: ViewState) {
  const highlight = v.phase === "ready" || v.phase === "resting" || v.phase === "paused";
  const idx = highlight && v.currentRepNumber <= currentReps ? v.currentRepNumber - 1 : -1;
  const groupIdx = idx >= 0 ? Math.floor(idx / 5) : -1;
  const groups = tallyEl.children;
  for (let g = 0; g < groups.length; g++) {
    (groups[g] as HTMLElement).classList.toggle("current", g === groupIdx);
  }
}

function pad2(n: number): string {
  return Math.max(0, Math.min(99, n)).toString().padStart(2, "0");
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
    // localStorage unavailable
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
