import { registerSW } from "virtual:pwa-register";
import { PullupTimer, type ViewState, type Phase } from "./timer";
import { beepCountdown, beepRepCue, beepDone, unlockAudio } from "./audio";

const REP_OPTIONS = [10, 20] as const;
const DEFAULT_REPS = 20;
const RPM_OPTIONS = [1, 2, 3, 4, 6] as const;
type Rpm = (typeof RPM_OPTIONS)[number];
const DEFAULT_RPM: Rpm = 1;
const MINUTE_MS = 60_000;
const DIAL_PATH_LENGTH = 100;
const SVG_NS = "http://www.w3.org/2000/svg";

const BANDS = [
  { id: "green", label: "Green", color: "#4f8a3d" },
  { id: "yellow", label: "Yellow", color: "#d9b020" },
  { id: "orange", label: "Orange", color: "#d97b29" },
  { id: "red", label: "Red", color: "#c0392b" },
  { id: "none", label: "None", color: "transparent" },
] as const;
type BandId = (typeof BANDS)[number]["id"];
const BAND_IDS = BANDS.map((b) => b.id) as readonly BandId[];
const DEFAULT_BAND: BandId = "green";

const TABS = ["workout", "log", "settings"] as const;
type TabId = (typeof TABS)[number];
const DEFAULT_TAB: TabId = "workout";

const WEIGHT_UNITS = ["kg", "lb"] as const;
type WeightUnit = (typeof WEIGHT_UNITS)[number];
const DEFAULT_WEIGHT_UNIT: WeightUnit = "kg";
const BODY_WEIGHT_KEY = "pullups.bodyWeight";
const WEIGHT_UNIT_KEY = "pullups.weightUnit";
const MAX_BODY_WEIGHT = 500;

interface Session {
  date: string;
  reps: number;
  rpm: number;
  band: BandId;
  elapsedMs: number;
  completedReps: number;
}
const SESSIONS_KEY = "pullups.sessions";
const MAX_SESSIONS = 50;
const LOG_DISPLAY_LIMIT = 6;

let currentReps: number = loadReps();
let currentRpm: Rpm = loadRpm();
let currentBand: BandId = loadBand();
let sessions: Session[] = loadSessions();
let currentTab: TabId = DEFAULT_TAB;
let currentBodyWeight: number | null = loadBodyWeight();
let currentWeightUnit: WeightUnit = loadWeightUnit();
let prevRenderedPhase: Phase = "idle";
let timer = new PullupTimer({
  totalReps: currentReps,
  intervalMs: intervalMsFor(currentRpm),
});

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="masthead">
    <div class="masthead-row">
      <h1>PULL<span class="accent">·</span>UPS</h1>
      <div class="masthead-stamp" id="logNumber">LOG&nbsp;N°&nbsp;${pad3(sessions.length + 1)}</div>
    </div>
    <div class="masthead-sub" id="modeLabel">${modeLabel(currentReps, currentRpm)}</div>
    <div class="hatching" aria-hidden="true"></div>
  </header>

  <nav class="tabs" role="tablist" id="tabBar">
    ${TABS.map(
      (t) =>
        `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === currentTab}" id="tab-${t}" aria-controls="panel-${t}">${tabLabel(t)}</button>`,
    ).join("")}
  </nav>

  <section class="tab-panel" id="panel-workout" role="tabpanel" aria-labelledby="tab-workout">
    <section class="seg" role="radiogroup" aria-label="Total reps" id="repSelector" style="--cols: ${REP_OPTIONS.length}">
      ${REP_OPTIONS.map(
        (n) =>
          `<button type="button" role="radio" data-reps="${n}" aria-checked="${n === currentReps}">${pad2(n)} REPS</button>`,
      ).join("")}
    </section>

    <section class="pace" id="rpmSelector" role="radiogroup" aria-label="Reps per minute">
      <div class="pace-caption">Pace · reps per minute</div>
      <div class="seg" style="--cols: ${RPM_OPTIONS.length}">
        ${RPM_OPTIONS.map(
          (n) =>
            `<button type="button" role="radio" data-rpm="${n}" aria-checked="${n === currentRpm}">${n}/MIN</button>`,
        ).join("")}
      </div>
    </section>

    <section class="bands" id="bandSelector" role="radiogroup" aria-label="Resistance band">
      <div class="bands-caption">Resistance band</div>
      <div class="bands-row">
        ${BANDS.map(
          (b) =>
            `<button type="button" role="radio" class="band-chip" data-band="${b.id}" aria-checked="${b.id === currentBand}" aria-label="${bandTitle(b.id)}" style="--band:${b.color}"><span class="band-dot${b.id === "none" ? " none" : ""}"></span><span class="band-name">${b.label}</span></button>`,
        ).join("")}
      </div>
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
  </section>

  <section class="tab-panel hidden" id="panel-log" role="tabpanel" aria-labelledby="tab-log">
    <section class="log" id="log" aria-label="Session log"></section>
  </section>

  <section class="tab-panel hidden" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
    <section class="settings-field">
      <label class="settings-caption" for="bodyWeightInput">Body weight</label>
      <div class="settings-weight">
        <input
          type="number"
          inputmode="decimal"
          id="bodyWeightInput"
          class="weight-input"
          min="0"
          max="${MAX_BODY_WEIGHT}"
          step="0.1"
          placeholder="—"
          autocomplete="off"
          value="${currentBodyWeight === null ? "" : String(currentBodyWeight)}"
        />
        <div class="seg seg-units" id="weightUnitSelector" role="radiogroup" aria-label="Weight unit" style="--cols: ${WEIGHT_UNITS.length}">
          ${WEIGHT_UNITS.map(
            (u) =>
              `<button type="button" role="radio" data-unit="${u}" aria-checked="${u === currentWeightUnit}">${u.toUpperCase()}</button>`,
          ).join("")}
        </div>
      </div>
      <p class="settings-hint">Saved on this device. Used to track your loaded weight over time.</p>
    </section>
  </section>

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
const rpmSelectorEl = byId("rpmSelector");
const bandSelectorEl = byId("bandSelector");
const logEl = byId("log");
const logNumberEl = byId("logNumber");
const tabBarEl = byId("tabBar");
const primaryBtn = byId("primaryBtn") as HTMLButtonElement;
const resetBtn = byId("resetBtn") as HTMLButtonElement;
const updateBtn = byId("updateBtn") as HTMLButtonElement;
const buildStampEl = byId("buildStamp");
const bodyWeightInput = byId("bodyWeightInput") as HTMLInputElement;
const weightUnitSelectorEl = byId("weightUnitSelector");

buildDialTicks();
renderDialNumerals(currentRpm);
renderTally(0);
renderBuildStamp();
renderLog();
syncWeightUnitSelector();
syncTabs();

tabBarEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-tab]");
  if (!btn) return;
  const next = btn.dataset.tab as TabId | undefined;
  if (!next || !TABS.includes(next)) return;
  if (next === currentTab) return;
  currentTab = next;
  syncTabs();
});

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

rpmSelectorEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-rpm]");
  if (!btn || btn.disabled) return;
  const next = Number(btn.dataset.rpm);
  if (!RPM_OPTIONS.includes(next as Rpm)) return;
  if (next === currentRpm) return;
  if (!canChangeReps()) return;
  setRpm(next as Rpm);
});

bandSelectorEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-band]");
  if (!btn || btn.disabled) return;
  const next = btn.dataset.band as BandId | undefined;
  if (!next || !BAND_IDS.includes(next)) return;
  if (next === currentBand) return;
  if (!canChangeReps()) return;
  setBand(next);
});

bodyWeightInput.addEventListener("input", () => {
  const raw = bodyWeightInput.value.trim();
  if (raw === "") {
    currentBodyWeight = null;
    saveBodyWeight(null);
    return;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_BODY_WEIGHT) return;
  currentBodyWeight = Math.round(n * 10) / 10;
  saveBodyWeight(currentBodyWeight);
});

weightUnitSelectorEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-unit]");
  if (!btn) return;
  const next = btn.dataset.unit as WeightUnit | undefined;
  if (!next || !WEIGHT_UNITS.includes(next)) return;
  if (next === currentWeightUnit) return;
  currentWeightUnit = next;
  saveWeightUnit(next);
  syncWeightUnitSelector();
});

logEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.closest("#clearLogBtn")) return;
  if (sessions.length === 0) return;
  if (!window.confirm("Clear the entire session log?")) return;
  sessions = [];
  saveSessions(sessions);
  renderLog();
  updateLogNumber();
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
  rebuildTimer();
  modeLabelEl.textContent = modeLabel(currentReps, currentRpm);
  bigOfEl.textContent = `of ${pad2(currentReps)}`;
  renderTally(0);
  syncRepSelector();
  syncRpmSelector();
  syncBandSelector();
}

function setRpm(rpm: Rpm) {
  currentRpm = rpm;
  saveRpm(rpm);
  rebuildTimer();
  modeLabelEl.textContent = modeLabel(currentReps, currentRpm);
  renderDialNumerals(currentRpm);
  syncRepSelector();
  syncRpmSelector();
  syncBandSelector();
}

function rebuildTimer() {
  timer = new PullupTimer({
    totalReps: currentReps,
    intervalMs: intervalMsFor(currentRpm),
  });
}

function setBand(id: BandId) {
  currentBand = id;
  saveBand(id);
  syncBandSelector();
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

function syncRpmSelector() {
  const canChange = canChangeReps();
  for (const btn of rpmSelectorEl.querySelectorAll<HTMLButtonElement>("button[data-rpm]")) {
    const n = Number(btn.dataset.rpm);
    const selected = n === currentRpm;
    btn.setAttribute("aria-checked", String(selected));
    btn.classList.toggle("active", selected);
    btn.disabled = !canChange;
  }
}

function syncBandSelector() {
  const canChange = canChangeReps();
  for (const btn of bandSelectorEl.querySelectorAll<HTMLButtonElement>("button[data-band]")) {
    const selected = btn.dataset.band === currentBand;
    btn.setAttribute("aria-checked", String(selected));
    btn.classList.toggle("active", selected);
    // Keep the chosen band visible while a workout is in progress; only the
    // alternatives are locked out.
    btn.disabled = !canChange && !selected;
  }
}

function syncWeightUnitSelector() {
  for (const btn of weightUnitSelectorEl.querySelectorAll<HTMLButtonElement>("button[data-unit]")) {
    const selected = btn.dataset.unit === currentWeightUnit;
    btn.setAttribute("aria-checked", String(selected));
    btn.classList.toggle("active", selected);
  }
}

function syncTabs() {
  for (const btn of tabBarEl.querySelectorAll<HTMLButtonElement>("button[data-tab]")) {
    const selected = btn.dataset.tab === currentTab;
    btn.setAttribute("aria-selected", String(selected));
    btn.classList.toggle("active", selected);
  }
  for (const t of TABS) {
    const panel = document.getElementById(`panel-${t}`);
    if (panel) panel.classList.toggle("hidden", t !== currentTab);
  }
}

function render(v: ViewState) {
  if (v.phase === "done" && prevRenderedPhase !== "done") {
    recordSession(v);
  }
  prevRenderedPhase = v.phase;

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
  syncRpmSelector();
  syncBandSelector();

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

function modeLabel(reps: number, rpm: Rpm): string {
  const intervalSec = Math.round(intervalMsFor(rpm) / 1000);
  const pace = rpm === 1 ? "one rep per minute" : `${rpm} reps per minute`;
  return `${pad2(reps)} reps · ${intervalSec}s rest · ${pace}`;
}

function tabLabel(t: TabId): string {
  switch (t) {
    case "workout":
      return "Workout";
    case "log":
      return "Log";
    case "settings":
      return "Settings";
  }
}

function intervalMsFor(rpm: Rpm): number {
  return Math.round(MINUTE_MS / rpm);
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

function buildDialTicks() {
  const ticksGroup = byId("dialTicks");
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

  void dialEl;
}

function renderDialNumerals(rpm: Rpm) {
  const numeralsGroup = byId("dialNumerals");
  numeralsGroup.innerHTML = "";
  const cx = 170;
  const cy = 170;
  const intervalSec = Math.round(intervalMsFor(rpm) / 1000);

  const numerals: Array<{ at: number; label: string }> = [
    { at: 0, label: String(intervalSec) },
    { at: 15, label: String(Math.round(intervalSec * 0.25)) },
    { at: 30, label: String(Math.round(intervalSec * 0.5)) },
    { at: 45, label: String(Math.round(intervalSec * 0.75)) },
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

function loadRpm(): Rpm {
  try {
    const raw = localStorage.getItem("pullups.rpm");
    const n = raw === null ? NaN : Number(raw);
    if (RPM_OPTIONS.includes(n as Rpm)) return n as Rpm;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_RPM;
}

function saveRpm(rpm: Rpm) {
  try {
    localStorage.setItem("pullups.rpm", String(rpm));
  } catch {
    // ignore
  }
}

function loadBand(): BandId {
  try {
    const raw = localStorage.getItem("pullups.band");
    if (raw !== null && BAND_IDS.includes(raw as BandId)) return raw as BandId;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_BAND;
}

function saveBand(id: BandId) {
  try {
    localStorage.setItem("pullups.band", id);
  } catch {
    // ignore
  }
}

function loadBodyWeight(): number | null {
  try {
    const raw = localStorage.getItem(BODY_WEIGHT_KEY);
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= MAX_BODY_WEIGHT) return n;
  } catch {
    // localStorage unavailable
  }
  return null;
}

function saveBodyWeight(n: number | null) {
  try {
    if (n === null) localStorage.removeItem(BODY_WEIGHT_KEY);
    else localStorage.setItem(BODY_WEIGHT_KEY, String(n));
  } catch {
    // ignore
  }
}

function loadWeightUnit(): WeightUnit {
  try {
    const raw = localStorage.getItem(WEIGHT_UNIT_KEY);
    if (raw !== null && WEIGHT_UNITS.includes(raw as WeightUnit)) return raw as WeightUnit;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_WEIGHT_UNIT;
}

function saveWeightUnit(u: WeightUnit) {
  try {
    localStorage.setItem(WEIGHT_UNIT_KEY, u);
  } catch {
    // ignore
  }
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x): Session[] => {
      const s = normalizeSession(x);
      return s ? [s] : [];
    });
  } catch {
    return [];
  }
}

function normalizeSession(x: unknown): Session | null {
  if (typeof x !== "object" || x === null) return null;
  const s = x as Record<string, unknown>;
  if (
    typeof s.date !== "string" ||
    typeof s.reps !== "number" ||
    typeof s.band !== "string" ||
    !BAND_IDS.includes(s.band as BandId) ||
    typeof s.elapsedMs !== "number" ||
    typeof s.completedReps !== "number"
  ) {
    return null;
  }
  const rpm = typeof s.rpm === "number" && RPM_OPTIONS.includes(s.rpm as Rpm) ? (s.rpm as number) : 1;
  return {
    date: s.date,
    reps: s.reps,
    rpm,
    band: s.band as BandId,
    elapsedMs: s.elapsedMs,
    completedReps: s.completedReps,
  };
}

function saveSessions(list: Session[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

function recordSession(v: ViewState) {
  const session: Session = {
    date: new Date().toISOString(),
    reps: currentReps,
    rpm: currentRpm,
    band: currentBand,
    elapsedMs: Math.round(v.totalElapsedMs),
    completedReps: v.repsCompleted,
  };
  sessions.unshift(session);
  if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
  saveSessions(sessions);
  renderLog();
  updateLogNumber();
}

function updateLogNumber() {
  logNumberEl.textContent = `LOG N° ${pad3(sessions.length + 1)}`;
}

function renderLog() {
  if (sessions.length === 0) {
    logEl.innerHTML = `<div class="log-empty">No sessions logged yet — finish a workout to start your log.</div>`;
    return;
  }

  const recent = sessions.slice(0, LOG_DISPLAY_LIMIT);
  const rows = recent
    .map(
      (s) => `
      <li class="log-item">
        <span class="log-band${s.band === "none" ? " none" : ""}" style="--band:${bandColor(s.band)}" title="${bandTitle(s.band)}"></span>
        <span class="log-reps">${pad2(s.completedReps)}/${pad2(s.reps)}</span>
        <span class="log-pace" title="Reps per minute">${s.rpm}/min</span>
        <span class="log-date">${formatLogDate(s.date)}</span>
        <span class="log-time">${formatClock(s.elapsedMs)}</span>
      </li>`,
    )
    .join("");

  const more =
    sessions.length > LOG_DISPLAY_LIMIT
      ? `<div class="log-more">+${sessions.length - LOG_DISPLAY_LIMIT} earlier</div>`
      : "";

  logEl.innerHTML = `
    <div class="log-head">
      <span class="log-title">Session Log</span>
      <button type="button" class="log-clear" id="clearLogBtn">Clear</button>
    </div>
    <ol class="log-list">${rows}</ol>
    ${more}
  `;
}

function bandColor(id: BandId): string {
  return (BANDS.find((b) => b.id === id) ?? BANDS[0]).color;
}

function bandLabel(id: BandId): string {
  return (BANDS.find((b) => b.id === id) ?? BANDS[0]).label;
}

function bandTitle(id: BandId): string {
  return id === "none" ? "No band" : `${bandLabel(id)} band`;
}

function formatLogDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function pad3(n: number): string {
  return Math.max(0, Math.min(999, n)).toString().padStart(3, "0");
}
