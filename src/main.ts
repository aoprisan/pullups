import { registerSW } from "virtual:pwa-register";
import { PullupTimer, type ViewState, type SetRecord } from "./timer";
import { beepCountdown, beepRepCue, beepDone, unlockAudio } from "./audio";

const DIAL_PATH_LENGTH = 100;
const SVG_NS = "http://www.w3.org/2000/svg";
const LAP_MS = 60_000;
const DEFAULT_REPS_FOR_DIAL = 10;
const MAX_DIAL_REPS = 99;

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
  band: BandId;
  elapsedMs: number;
  totalReps: number;
  sets: SetRecord[];
}
const SESSIONS_KEY = "pullups.sessions";
const MAX_SESSIONS = 50;
const LOG_DISPLAY_LIMIT = 6;

let currentBand: BandId = loadBand();
let sessions: Session[] = loadSessions();
let currentTab: TabId = DEFAULT_TAB;
let currentBodyWeight: number | null = loadBodyWeight();
let currentWeightUnit: WeightUnit = loadWeightUnit();
let dialReps = DEFAULT_REPS_FOR_DIAL;
const timer = new PullupTimer();

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="masthead">
    <div class="masthead-row">
      <h1>PULL<span class="accent">·</span>UPS</h1>
      <div class="masthead-stamp" id="logNumber">LOG&nbsp;N°&nbsp;${pad3(sessions.length + 1)}</div>
    </div>
    <div class="masthead-sub" id="modeLabel">Open sets · log reps after each</div>
    <div class="hatching" aria-hidden="true"></div>
  </header>

  <nav class="tabs" role="tablist" id="tabBar">
    ${TABS.map(
      (t) =>
        `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === currentTab}" id="tab-${t}" aria-controls="panel-${t}">${tabLabel(t)}</button>`,
    ).join("")}
  </nav>

  <section class="tab-panel" id="panel-workout" role="tabpanel" aria-labelledby="tab-workout">
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
        <div class="big-number" id="big">0:00</div>
        <div class="dial-status" id="dialStatus">PRESS START SESSION</div>
        <div class="rep-stepper hidden" id="repStepper" aria-label="Reps logged">
          <button type="button" class="step-btn" data-step="-1" aria-label="Decrease reps">−</button>
          <button type="button" class="step-btn small" data-step="-5" aria-label="Decrease by five">−5</button>
          <button type="button" class="step-btn small" data-step="5" aria-label="Increase by five">+5</button>
          <button type="button" class="step-btn" data-step="1" aria-label="Increase reps">+</button>
        </div>
      </div>
    </div>

    <section class="tally" id="tally" aria-label="Sets logged"></section>

    <div class="meta">
      <span class="meta-label">Session</span>
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
    <button class="primary idle" id="primaryBtn">START SESSION</button>
    <button class="secondary danger hidden" id="endSessionBtn">End session</button>
    <button class="secondary" id="resetBtn" disabled>Reset</button>
    <button class="secondary update" id="updateBtn" data-state="idle">Update app</button>
    <div class="build-stamp" id="buildStamp"></div>
  </div>
`;

const dialFillEl = byId("dialFill") as unknown as SVGCircleElement;
const dialCenterEl = byId("dialCenter");
const eyebrowEl = byId("eyebrow");
const bigEl = byId("big");
const dialStatusEl = byId("dialStatus");
const repStepperEl = byId("repStepper");
const tallyEl = byId("tally");
const elapsedEl = byId("elapsed");
const bandSelectorEl = byId("bandSelector");
const logEl = byId("log");
const logNumberEl = byId("logNumber");
const tabBarEl = byId("tabBar");
const primaryBtn = byId("primaryBtn") as HTMLButtonElement;
const endSessionBtn = byId("endSessionBtn") as HTMLButtonElement;
const resetBtn = byId("resetBtn") as HTMLButtonElement;
const updateBtn = byId("updateBtn") as HTMLButtonElement;
const buildStampEl = byId("buildStamp");
const bodyWeightInput = byId("bodyWeightInput") as HTMLInputElement;
const weightUnitSelectorEl = byId("weightUnitSelector");

buildDialTicks();
renderDialNumerals();
renderTally([]);
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

bandSelectorEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-band]");
  if (!btn || btn.disabled) return;
  const next = btn.dataset.band as BandId | undefined;
  if (!next || !BAND_IDS.includes(next)) return;
  if (next === currentBand) return;
  if (!canChangeBand()) return;
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

repStepperEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-step]");
  if (!btn) return;
  const step = Number(btn.dataset.step);
  if (!Number.isFinite(step)) return;
  dialReps = Math.max(0, Math.min(MAX_DIAL_REPS, dialReps + step));
  pulseBig();
});

primaryBtn.addEventListener("click", () => {
  unlockAudio();
  const now = performance.now();
  switch (timer.currentPhase) {
    case "idle":
    case "done":
      dialReps = DEFAULT_REPS_FOR_DIAL;
      timer.start(now);
      break;
    case "working":
      timer.setDone(now);
      break;
    case "logging":
      timer.logReps(dialReps, now);
      break;
    case "resting":
      timer.nextSet(now);
      break;
  }
});

endSessionBtn.addEventListener("click", () => {
  const now = performance.now();
  if (timer.currentPhase === "idle" || timer.currentPhase === "done") return;
  if (timer.completedSets === 0 && timer.currentPhase !== "logging") {
    if (!window.confirm("End session without logging any sets?")) return;
  }
  timer.endSession(now);
});

resetBtn.addEventListener("click", () => {
  if (timer.currentPhase !== "idle" && timer.currentPhase !== "done") {
    if (!window.confirm("Discard this session?")) return;
  }
  timer.reset();
  dialReps = DEFAULT_REPS_FOR_DIAL;
});

// ───────────────────────── APP UPDATES ─────────────────────────
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
    if (userRequestedUpdate) reloadForUpdate();
    else setUpdateState("ready");
  },
});

updateBtn.addEventListener("click", async () => {
  const state = updateBtn.dataset.state;
  if (state === "ready") {
    reloadForUpdate();
    return;
  }
  if (state === "checking" || state === "updating") return;

  userRequestedUpdate = true;
  setUpdateState("checking");

  if (!swRegistration) {
    window.location.reload();
    return;
  }
  try {
    await swRegistration.update();
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

let prevSetsCount = 0;

function frame(now: number) {
  const view = timer.tick(now);
  render(view);
  if (view.enteredPhase === "working") {
    beepRepCue();
    pulseBig();
  } else if (view.enteredPhase === "logging") {
    const seed = timer.lastReps;
    dialReps = seed === null ? DEFAULT_REPS_FOR_DIAL : seed;
    beepCountdown();
    pulseBig();
  } else if (view.enteredPhase === "done") {
    beepDone();
    if (view.setsCompleted > 0) recordSession(view);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setBand(id: BandId) {
  currentBand = id;
  saveBand(id);
  syncBandSelector();
}

function canChangeBand(): boolean {
  const p = timer.currentPhase;
  return p === "idle" || p === "done";
}

function syncBandSelector() {
  const canChange = canChangeBand();
  for (const btn of bandSelectorEl.querySelectorAll<HTMLButtonElement>("button[data-band]")) {
    const selected = btn.dataset.band === currentBand;
    btn.setAttribute("aria-checked", String(selected));
    btn.classList.toggle("active", selected);
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
  bigEl.textContent = bigNumberText(v);
  bigEl.classList.toggle("timer", v.phase === "working" || v.phase === "resting");
  bigEl.classList.toggle("count", v.phase === "logging");
  bigEl.classList.toggle("done-state", v.phase === "done");

  eyebrowEl.textContent = eyebrowLabel(v);
  dialStatusEl.textContent = statusLabel(v);
  repStepperEl.classList.toggle("hidden", v.phase !== "logging");

  applyDialFill(v);

  elapsedEl.textContent = formatClock(v.totalElapsedMs);

  if (v.sets.length !== prevSetsCount || v.phase === "idle" || v.phase === "done") {
    renderTally(v.sets);
    prevSetsCount = v.sets.length;
  }

  syncBandSelector();

  primaryBtn.className = `primary ${v.phase}`;
  primaryBtn.textContent = primaryLabel(v);

  endSessionBtn.classList.toggle(
    "hidden",
    v.phase === "idle" || v.phase === "done",
  );
  endSessionBtn.disabled = v.phase === "idle" || v.phase === "done";

  resetBtn.disabled = v.phase === "idle";
}

function bigNumberText(v: ViewState): string {
  switch (v.phase) {
    case "idle":
      return "0:00";
    case "working":
      return formatClock(v.workElapsedMs);
    case "logging":
      return pad2(dialReps);
    case "resting":
      return formatClock(v.restElapsedMs);
    case "done":
      return String(v.totalReps);
  }
}

function eyebrowLabel(v: ViewState): string {
  switch (v.phase) {
    case "idle":
      return "READY";
    case "working":
      return `SET ${pad2(v.setNumber)}`;
    case "logging":
      return `LOG SET ${pad2(v.setNumber)}`;
    case "resting":
      return "REST";
    case "done":
      return "DONE";
  }
}

function statusLabel(v: ViewState): string {
  switch (v.phase) {
    case "idle":
      return "TAP START SESSION";
    case "working":
      return "TAP DONE SET WHEN FINISHED";
    case "logging":
      return "DIAL REPS · TAP CONFIRM";
    case "resting":
      return v.totalReps === 0
        ? "REST · TAP START SET WHEN READY"
        : `${v.totalReps} REPS · ${pad2(v.setsCompleted)} SETS`;
    case "done":
      return `${v.totalReps} REPS · ${pad2(v.setsCompleted)} SETS · ${formatClock(v.totalElapsedMs)}`;
  }
}

function primaryLabel(v: ViewState): string {
  switch (v.phase) {
    case "idle":
      return "START SESSION";
    case "working":
      return "DONE SET";
    case "logging":
      return `CONFIRM ${pad2(dialReps)}`;
    case "resting":
      return "START SET";
    case "done":
      return "NEW SESSION";
  }
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

function applyDialFill(v: ViewState) {
  const fill = dialFillEl;
  fill.classList.remove("idle", "working", "logging", "resting", "done");
  fill.classList.add(v.phase);

  let offset = DIAL_PATH_LENGTH;
  if (v.phase === "working") {
    const frac = (v.workElapsedMs % LAP_MS) / LAP_MS;
    offset = (1 - frac) * DIAL_PATH_LENGTH;
  } else if (v.phase === "resting") {
    const frac = (v.restElapsedMs % LAP_MS) / LAP_MS;
    offset = (1 - frac) * DIAL_PATH_LENGTH;
  }
  fill.setAttribute("stroke-dashoffset", offset.toFixed(2));
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
}

function renderDialNumerals() {
  const numeralsGroup = byId("dialNumerals");
  numeralsGroup.innerHTML = "";
  const cx = 170;
  const cy = 170;

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
}

function renderTally(sets: ReadonlyArray<SetRecord>) {
  if (sets.length === 0) {
    tallyEl.innerHTML = `<div class="tally-empty">No sets logged yet</div>`;
    return;
  }
  tallyEl.innerHTML = sets
    .map(
      (s, i) =>
        `<div class="tally-set"><span class="tally-set-n">${pad2(i + 1)}</span><span class="tally-set-reps">${s.reps}</span></div>`,
    )
    .join("");
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
    typeof s.band !== "string" ||
    !BAND_IDS.includes(s.band as BandId) ||
    typeof s.elapsedMs !== "number"
  ) {
    return null;
  }
  let sets: SetRecord[] = [];
  if (Array.isArray(s.sets)) {
    sets = s.sets.flatMap((raw): SetRecord[] => {
      if (typeof raw !== "object" || raw === null) return [];
      const r = raw as Record<string, unknown>;
      if (typeof r.reps !== "number") return [];
      return [
        {
          reps: r.reps,
          workMs: typeof r.workMs === "number" ? r.workMs : 0,
          restMsAfter: typeof r.restMsAfter === "number" ? r.restMsAfter : 0,
        },
      ];
    });
  }
  const totalReps =
    typeof s.totalReps === "number"
      ? s.totalReps
      : sets.reduce((sum, set) => sum + set.reps, 0);
  return {
    date: s.date,
    band: s.band as BandId,
    elapsedMs: s.elapsedMs,
    totalReps,
    sets,
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
    band: currentBand,
    elapsedMs: Math.round(v.totalElapsedMs),
    totalReps: v.totalReps,
    sets: v.sets.map((s) => ({ ...s })),
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
        <span class="log-reps">${s.totalReps}</span>
        <span class="log-pace" title="Sets">${s.sets.length} sets</span>
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
