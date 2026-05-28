import { registerSW } from "virtual:pwa-register";
import { PullupTimer, type ViewState, type SetRecord } from "./timer";
import { EmomTimer, type EmomViewState, type EmomSetRecord } from "./emomTimer";
import { beepCountdown, beepRepCue, beepDone, unlockAudio } from "./audio";
import {
  analyzeSessionInClaude,
  copySessionPrompt,
  shareSessionPng,
  type SessionData,
  type AnalyzeResult,
  type CopyResult,
  type ShareResult,
} from "./exporters";

const DIAL_PATH_LENGTH = 100;
const SVG_NS = "http://www.w3.org/2000/svg";
const LAP_MS = 60_000;
const DEFAULT_REPS_FOR_DIAL = 3;
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

const TABS = ["sets", "emom", "log", "settings"] as const;
type TabId = (typeof TABS)[number];
const DEFAULT_TAB: TabId = "sets";

const WEIGHT_UNITS = ["kg", "lb"] as const;
type WeightUnit = (typeof WEIGHT_UNITS)[number];
const DEFAULT_WEIGHT_UNIT: WeightUnit = "kg";
const BODY_WEIGHT_KEY = "pullups.bodyWeight";
const WEIGHT_UNIT_KEY = "pullups.weightUnit";
const MAX_BODY_WEIGHT = 500;

const EMOM_CONFIG_KEY = "pullups.emomConfig";
const EMOM_DURATIONS = [10, 20] as const;
type EmomDuration = (typeof EMOM_DURATIONS)[number];
const DEFAULT_EMOM_REPS = 1;
const DEFAULT_EMOM_MINUTES: EmomDuration = 10;
const MIN_EMOM_REPS = 1;
const MAX_EMOM_REPS = 20;

type SessionType = "open" | "emom";

interface OpenSession {
  type: "open";
  date: string;
  band: BandId;
  elapsedMs: number;
  totalReps: number;
  sets: SetRecord[];
}

interface EmomSession {
  type: "emom";
  date: string;
  band: BandId;
  elapsedMs: number;
  totalReps: number;
  targetRepsPerMin: number;
  targetMinutes: number;
  sets: EmomSetRecord[];
}

type Session = OpenSession | EmomSession;

const SESSIONS_KEY = "pullups.sessions";
const MAX_SESSIONS = 50;
const LOG_DISPLAY_LIMIT = 6;

let currentBand: BandId = loadBand();
let sessions: Session[] = loadSessions();
let currentTab: TabId = DEFAULT_TAB;
let selectedSessionId: string | null = null;
let currentBodyWeight: number | null = loadBodyWeight();
let currentWeightUnit: WeightUnit = loadWeightUnit();
let dialReps = DEFAULT_REPS_FOR_DIAL;
let emomReps: number = DEFAULT_EMOM_REPS;
let emomMinutes: EmomDuration = DEFAULT_EMOM_MINUTES;
({ reps: emomReps, minutes: emomMinutes } = loadEmomConfig());
const setsTimer = new PullupTimer();
const emomTimer = new EmomTimer();
emomTimer.setConfig(emomMinutes, emomReps);

const app = document.getElementById("app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <header class="masthead">
    <div class="masthead-row">
      <h1>PULL<span class="accent">·</span>UPS</h1>
      <div class="masthead-stamp" id="logNumber">LOG&nbsp;N°&nbsp;${pad3(sessions.length + 1)}</div>
    </div>
    <div class="masthead-sub" id="modeLabel">Pull-up workout log</div>
    <div class="hatching" aria-hidden="true"></div>
  </header>

  <nav class="tabs tabs-4" role="tablist" id="tabBar">
    ${TABS.map(
      (t) =>
        `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === currentTab}" id="tab-${t}" aria-controls="panel-${t}">${tabLabel(t)}</button>`,
    ).join("")}
  </nav>

  <section class="tab-panel" id="panel-sets" role="tabpanel" aria-labelledby="tab-sets">
    ${renderBandSelectorHtml("sets")}
    ${renderDialHtml("sets")}
    <section class="tally" id="tally-sets" aria-label="Sets logged"></section>
    <div class="meta">
      <span class="meta-label">Session</span>
      <span class="meta-value" id="elapsed-sets">0:00</span>
    </div>
    <div class="controls panel-controls" id="controls-sets">
      <button class="primary idle" id="primaryBtn-sets">START SESSION</button>
      <button class="secondary danger hidden" id="endSessionBtn-sets">End session</button>
      <button class="secondary" id="resetBtn-sets" disabled>Reset</button>
    </div>
  </section>

  <section class="tab-panel hidden" id="panel-emom" role="tabpanel" aria-labelledby="tab-emom">
    ${renderBandSelectorHtml("emom")}
    <section class="emom-config" id="emomConfig" aria-label="EMOM configuration">
      <div class="emom-config-row">
        <div class="emom-config-label">Reps / minute</div>
        <div class="emom-config-stepper" id="emomRepsStepper" aria-label="Reps per minute">
          <button type="button" class="step-btn small" data-emom-reps="-1" aria-label="Decrease reps per minute">−</button>
          <div class="emom-config-value" id="emomRepsValue">${emomReps}</div>
          <button type="button" class="step-btn small" data-emom-reps="1" aria-label="Increase reps per minute">+</button>
        </div>
      </div>
      <div class="emom-config-row">
        <div class="emom-config-label">Duration</div>
        <div class="seg seg-emom" id="emomMinutesSelector" role="radiogroup" aria-label="Duration" style="--cols:${EMOM_DURATIONS.length}">
          ${EMOM_DURATIONS.map(
            (m) =>
              `<button type="button" role="radio" data-emom-minutes="${m}" aria-checked="${m === emomMinutes}">${m} MIN</button>`,
          ).join("")}
        </div>
      </div>
    </section>
    ${renderDialHtml("emom")}
    <section class="tally" id="tally-emom" aria-label="Minutes logged"></section>
    <div class="meta">
      <span class="meta-label">EMOM</span>
      <span class="meta-value" id="elapsed-emom">0:00</span>
    </div>
    <div class="controls panel-controls" id="controls-emom">
      <button class="primary idle" id="primaryBtn-emom">START EMOM</button>
      <button class="secondary danger hidden" id="endSessionBtn-emom">End EMOM</button>
      <button class="secondary" id="resetBtn-emom" disabled>Reset</button>
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

  <div class="controls global-controls">
    <button class="secondary update" id="updateBtn" data-state="idle">Update app</button>
    <div class="build-stamp" id="buildStamp"></div>
  </div>
`;

const tabBarEl = byId("tabBar");
const logEl = byId("log");
const logNumberEl = byId("logNumber");
const updateBtn = byId("updateBtn") as HTMLButtonElement;
const buildStampEl = byId("buildStamp");
const bodyWeightInput = byId("bodyWeightInput") as HTMLInputElement;
const weightUnitSelectorEl = byId("weightUnitSelector");

// ─── Sets tab refs ────────────────────────────────────────────
const setsDialFillEl = byId("dialFill-sets") as unknown as SVGCircleElement;
const setsDialCenterEl = byId("dialCenter-sets");
const setsEyebrowEl = byId("eyebrow-sets");
const setsBigEl = byId("big-sets");
const setsDialStatusEl = byId("dialStatus-sets");
const setsRepStepperEl = byId("repStepper-sets");
const setsTallyEl = byId("tally-sets");
const setsElapsedEl = byId("elapsed-sets");
const setsBandSelectorEl = byId("bandSelector-sets");
const setsPrimaryBtn = byId("primaryBtn-sets") as HTMLButtonElement;
const setsEndBtn = byId("endSessionBtn-sets") as HTMLButtonElement;
const setsResetBtn = byId("resetBtn-sets") as HTMLButtonElement;

// ─── EMOM tab refs ────────────────────────────────────────────
const emomDialFillEl = byId("dialFill-emom") as unknown as SVGCircleElement;
const emomDialCenterEl = byId("dialCenter-emom");
const emomEyebrowEl = byId("eyebrow-emom");
const emomBigEl = byId("big-emom");
const emomDialStatusEl = byId("dialStatus-emom");
const emomRepStepperEl = byId("repStepper-emom");
const emomTallyEl = byId("tally-emom");
const emomElapsedEl = byId("elapsed-emom");
const emomBandSelectorEl = byId("bandSelector-emom");
const emomPrimaryBtn = byId("primaryBtn-emom") as HTMLButtonElement;
const emomEndBtn = byId("endSessionBtn-emom") as HTMLButtonElement;
const emomResetBtn = byId("resetBtn-emom") as HTMLButtonElement;
const emomConfigEl = byId("emomConfig");
const emomRepsValueEl = byId("emomRepsValue");
const emomMinutesSelectorEl = byId("emomMinutesSelector");

buildDialTicks("sets");
buildDialTicks("emom");
renderDialNumerals("sets");
renderDialNumerals("emom");
renderOpenTally([]);
renderEmomTally([], emomMinutes);
renderBuildStamp();
renderLog();
syncWeightUnitSelector();
syncTabs();
syncBandSelectors();
syncEmomConfig();

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

function wireBandSelector(el: HTMLElement) {
  el.addEventListener("click", (e) => {
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
}
wireBandSelector(setsBandSelectorEl);
wireBandSelector(emomBandSelectorEl);

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

  if (target.closest("#clearLogBtn")) {
    if (sessions.length === 0) return;
    if (!window.confirm("Clear the entire session log?")) return;
    sessions = [];
    selectedSessionId = null;
    saveSessions(sessions);
    renderLog();
    updateLogNumber();
    return;
  }

  if (target.closest("#logBackBtn")) {
    selectedSessionId = null;
    renderLog();
    return;
  }

  const openBtn = target.closest<HTMLButtonElement>("button[data-open-session]");
  if (openBtn) {
    const id = openBtn.dataset.openSession;
    if (id && findSession(id)) {
      selectedSessionId = id;
      renderLog();
    }
    return;
  }

  const exportBtn = target.closest<HTMLButtonElement>("button[data-export]");
  if (exportBtn) {
    const id = exportBtn.dataset.sessionId ?? sessions[0]?.date ?? null;
    const session = id ? findSession(id) : null;
    if (!session) return;
    const kind = exportBtn.dataset.export;
    if (kind === "png") void runExport("share-png", exportBtn, session);
    else if (kind === "claude") void runExport("ask-claude", exportBtn, session);
    else if (kind === "copy") void runExport("copy-prompt", exportBtn, session);
  }
});

function findSession(id: string): Session | null {
  return sessions.find((s) => s.date === id) ?? null;
}

setsRepStepperEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-step]");
  if (!btn) return;
  const step = Number(btn.dataset.step);
  if (!Number.isFinite(step)) return;
  setsApplyRepDelta(step);
});

emomRepStepperEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLButtonElement>("button[data-step]");
  if (!btn) return;
  const step = Number(btn.dataset.step);
  if (!Number.isFinite(step)) return;
  emomApplyRepDelta(step);
});

function setsApplyRepDelta(delta: number) {
  dialReps = Math.max(0, Math.min(MAX_DIAL_REPS, dialReps + delta));
  pulseBig(setsDialCenterEl);
}

function emomApplyRepDelta(delta: number) {
  emomTimer.adjustReps(delta);
  pulseBig(emomDialCenterEl);
}

// ───────────────────────── KNOB INTERACTION ─────────────────────────
// Drag the dial like a joystick: one full revolution = ±1 rep.
// Clockwise = +1, counter-clockwise = -1. Partial turns reset on lift.

const DEGREES_PER_REP = 360;
const DEAD_ZONE_PX = 22;
const DETENTS_PER_REV = 12;
const GRIP_RADIUS = 96;

function buzz(ms: number) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(ms);
  }
}

function setupKnob(
  dialStage: HTMLElement,
  gripEl: SVGCircleElement,
  arcEl: SVGCircleElement,
  isActive: () => boolean,
  applyDelta: (delta: number) => void,
) {
  let pointerId: number | null = null;
  let lastAngle = 0;
  let accumulated = 0;
  let lastDetent = 0;

  function vectorAt(clientX: number, clientY: number) {
    const rect = dialStage.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    return { dx, dy, dist: Math.hypot(dx, dy), angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI };
  }

  // Visible dial face radius in viewBox units (154) over half the 340-unit viewBox.
  const DIAL_FACE_FRACTION = 154 / 170;
  function isInsideDialFace(dist: number): boolean {
    const rect = dialStage.getBoundingClientRect();
    const halfMin = Math.min(rect.width, rect.height) / 2;
    return dist <= halfMin * DIAL_FACE_FRACTION;
  }

  function placeGrip(angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180;
    const x = 170 + Math.cos(rad) * GRIP_RADIUS;
    const y = 170 + Math.sin(rad) * GRIP_RADIUS;
    gripEl.setAttribute("cx", x.toFixed(2));
    gripEl.setAttribute("cy", y.toFixed(2));
  }

  function paintArc() {
    // 1 path unit = 1% of the circumference; show signed fraction of the revolution.
    const frac = Math.max(-1, Math.min(1, accumulated / 360));
    const offset = (1 - Math.abs(frac)) * DIAL_PATH_LENGTH;
    arcEl.setAttribute("stroke-dashoffset", offset.toFixed(2));
    arcEl.classList.toggle("reverse", frac < 0);
  }

  function setActive(on: boolean) {
    gripEl.classList.toggle("active", on);
    arcEl.classList.toggle("active", on);
    dialStage.classList.toggle("grabbing", on);
  }

  dialStage.addEventListener("pointerdown", (e) => {
    if (!isActive()) return;
    if (e.target instanceof Element && e.target.closest("button")) return;
    const v = vectorAt(e.clientX, e.clientY);
    // Square stage, round dial — corners aren't the knob, so leave them alone.
    if (!isInsideDialFace(v.dist)) return;
    pointerId = e.pointerId;
    lastAngle = v.angleDeg;
    accumulated = 0;
    lastDetent = 0;
    placeGrip(v.angleDeg);
    setActive(true);
    paintArc();
    try {
      dialStage.setPointerCapture(e.pointerId);
    } catch {
      // capture unsupported
    }
    e.preventDefault();
    buzz(6);
  });

  dialStage.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    const v = vectorAt(e.clientX, e.clientY);
    placeGrip(v.angleDeg);
    const from = lastAngle;
    lastAngle = v.angleDeg;
    // Near dead-centre, finger angle is unreliable — track visually but bank nothing.
    if (v.dist < DEAD_ZONE_PX) return;

    let delta = v.angleDeg - from;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    accumulated += delta;

    while (accumulated >= DEGREES_PER_REP) {
      accumulated -= DEGREES_PER_REP;
      applyDelta(1);
      buzz(18);
    }
    while (accumulated <= -DEGREES_PER_REP) {
      accumulated += DEGREES_PER_REP;
      applyDelta(-1);
      buzz(18);
    }

    const det = Math.floor((Math.abs(accumulated) / 360) * DETENTS_PER_REV);
    if (det !== lastDetent) {
      lastDetent = det;
      buzz(4);
    }
    paintArc();
  });

  function end(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    accumulated = 0;
    lastDetent = 0;
    setActive(false);
    paintArc();
    try {
      dialStage.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }
  dialStage.addEventListener("pointerup", end);
  dialStage.addEventListener("pointercancel", end);
}

setupKnob(
  setsDialCenterEl.parentElement as HTMLElement,
  byId("dialGrip-sets") as unknown as SVGCircleElement,
  byId("dialKnobArc-sets") as unknown as SVGCircleElement,
  () => setsTimer.currentPhase === "logging",
  setsApplyRepDelta,
);
setupKnob(
  emomDialCenterEl.parentElement as HTMLElement,
  byId("dialGrip-emom") as unknown as SVGCircleElement,
  byId("dialKnobArc-emom") as unknown as SVGCircleElement,
  () => emomTimer.currentPhase === "working",
  emomApplyRepDelta,
);

emomConfigEl.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  const repsBtn = target.closest<HTMLButtonElement>("button[data-emom-reps]");
  if (repsBtn) {
    if (!canChangeEmomConfig()) return;
    const delta = Number(repsBtn.dataset.emomReps);
    if (!Number.isFinite(delta)) return;
    emomReps = Math.max(MIN_EMOM_REPS, Math.min(MAX_EMOM_REPS, emomReps + delta));
    emomTimer.setConfig(emomMinutes, emomReps);
    saveEmomConfig({ reps: emomReps, minutes: emomMinutes });
    syncEmomConfig();
    return;
  }

  const minutesBtn = target.closest<HTMLButtonElement>("button[data-emom-minutes]");
  if (minutesBtn) {
    if (!canChangeEmomConfig()) return;
    const next = Number(minutesBtn.dataset.emomMinutes) as EmomDuration;
    if (!EMOM_DURATIONS.includes(next)) return;
    if (next === emomMinutes) return;
    emomMinutes = next;
    emomTimer.setConfig(emomMinutes, emomReps);
    saveEmomConfig({ reps: emomReps, minutes: emomMinutes });
    syncEmomConfig();
    renderEmomTally([], emomMinutes);
    return;
  }
});

setsPrimaryBtn.addEventListener("click", () => {
  unlockAudio();
  const now = performance.now();
  switch (setsTimer.currentPhase) {
    case "idle":
    case "done":
      dialReps = DEFAULT_REPS_FOR_DIAL;
      setsTimer.start(now);
      break;
    case "working":
      setsTimer.setDone(now);
      break;
    case "logging":
      setsTimer.logReps(dialReps, now);
      break;
    case "resting":
      setsTimer.nextSet(now);
      break;
  }
});

setsEndBtn.addEventListener("click", () => {
  const now = performance.now();
  if (setsTimer.currentPhase === "idle" || setsTimer.currentPhase === "done") return;
  if (setsTimer.completedSets === 0 && setsTimer.currentPhase !== "logging") {
    if (!window.confirm("End session without logging any sets?")) return;
  }
  setsTimer.endSession(now);
});

setsResetBtn.addEventListener("click", () => {
  if (setsTimer.currentPhase !== "idle" && setsTimer.currentPhase !== "done") {
    if (!window.confirm("Discard this session?")) return;
  }
  setsTimer.reset();
  dialReps = DEFAULT_REPS_FOR_DIAL;
});

emomPrimaryBtn.addEventListener("click", () => {
  unlockAudio();
  const now = performance.now();
  const phase = emomTimer.currentPhase;
  if (phase === "idle" || phase === "done") {
    emomTimer.setConfig(emomMinutes, emomReps);
    emomTimer.start(now);
  }
});

emomEndBtn.addEventListener("click", () => {
  const now = performance.now();
  if (emomTimer.currentPhase !== "working") return;
  if (!window.confirm("End the EMOM early?")) return;
  emomTimer.end(now);
});

emomResetBtn.addEventListener("click", () => {
  if (emomTimer.currentPhase === "working") {
    if (!window.confirm("Discard this EMOM?")) return;
  }
  emomTimer.reset();
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
let prevEmomSetsCount = 0;

function frame(now: number) {
  const openView = setsTimer.tick(now);
  renderOpen(openView);
  if (openView.enteredPhase === "working") {
    beepRepCue();
    pulseBig(setsDialCenterEl);
  } else if (openView.enteredPhase === "logging") {
    const seed = setsTimer.lastReps;
    dialReps = seed === null ? DEFAULT_REPS_FOR_DIAL : seed;
    beepCountdown();
    pulseBig(setsDialCenterEl);
  } else if (openView.enteredPhase === "done") {
    beepDone();
    if (openView.setsCompleted > 0) recordOpenSession(openView);
  }

  const emomView = emomTimer.tick(now);
  renderEmom(emomView);
  if (emomView.minuteCueAt !== null) {
    beepRepCue();
    pulseBig(emomDialCenterEl);
  }
  if (emomView.enteredPhase === "done") {
    beepDone();
    if (emomView.setsCompleted > 0) recordEmomSession(emomView);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setBand(id: BandId) {
  currentBand = id;
  saveBand(id);
  syncBandSelectors();
}

function canChangeBand(): boolean {
  const open = setsTimer.currentPhase;
  const emom = emomTimer.currentPhase;
  const openOk = open === "idle" || open === "done";
  const emomOk = emom === "idle" || emom === "done";
  return openOk && emomOk;
}

function canChangeEmomConfig(): boolean {
  const p = emomTimer.currentPhase;
  return p === "idle" || p === "done";
}

function syncBandSelectors() {
  const canChange = canChangeBand();
  for (const root of [setsBandSelectorEl, emomBandSelectorEl]) {
    for (const btn of root.querySelectorAll<HTMLButtonElement>("button[data-band]")) {
      const selected = btn.dataset.band === currentBand;
      btn.setAttribute("aria-checked", String(selected));
      btn.classList.toggle("active", selected);
      btn.disabled = !canChange && !selected;
    }
  }
}

function syncWeightUnitSelector() {
  for (const btn of weightUnitSelectorEl.querySelectorAll<HTMLButtonElement>("button[data-unit]")) {
    const selected = btn.dataset.unit === currentWeightUnit;
    btn.setAttribute("aria-checked", String(selected));
    btn.classList.toggle("active", selected);
  }
}

function syncEmomConfig() {
  emomRepsValueEl.textContent = String(emomReps);
  const editable = canChangeEmomConfig();
  for (const btn of emomConfigEl.querySelectorAll<HTMLButtonElement>("button")) {
    btn.disabled = !editable;
  }
  for (const btn of emomMinutesSelectorEl.querySelectorAll<HTMLButtonElement>("button[data-emom-minutes]")) {
    const selected = Number(btn.dataset.emomMinutes) === emomMinutes;
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

// ───────────────────────── OPEN-SETS RENDER ─────────────────────────

function renderOpen(v: ViewState) {
  setsBigEl.textContent = openBigText(v);
  setsBigEl.classList.toggle("timer", v.phase === "working" || v.phase === "resting");
  setsBigEl.classList.toggle("count", v.phase === "logging");
  setsBigEl.classList.toggle("done-state", v.phase === "done");

  setsEyebrowEl.textContent = openEyebrow(v);
  setsDialStatusEl.textContent = openStatus(v);
  setsRepStepperEl.classList.toggle("hidden", v.phase !== "logging");
  (setsDialCenterEl.parentElement as HTMLElement).classList.toggle(
    "grab-hint",
    v.phase === "logging",
  );

  applyOpenDialFill(v);

  setsElapsedEl.textContent = formatClock(v.totalElapsedMs);

  if (v.sets.length !== prevSetsCount || v.phase === "idle" || v.phase === "done") {
    renderOpenTally(v.sets);
    prevSetsCount = v.sets.length;
  }

  syncBandSelectors();

  setsPrimaryBtn.className = `primary ${v.phase}`;
  setsPrimaryBtn.textContent = openPrimaryLabel(v);

  setsEndBtn.classList.toggle("hidden", v.phase === "idle" || v.phase === "done");
  setsEndBtn.disabled = v.phase === "idle" || v.phase === "done";

  setsResetBtn.disabled = v.phase === "idle";
}

function openBigText(v: ViewState): string {
  switch (v.phase) {
    case "idle": return "0:00";
    case "working": return formatClock(v.workElapsedMs);
    case "logging": return pad2(dialReps);
    case "resting": return formatClock(v.restElapsedMs);
    case "done": return String(v.totalReps);
  }
}

function openEyebrow(v: ViewState): string {
  switch (v.phase) {
    case "idle": return "READY";
    case "working": return `SET ${pad2(v.setNumber)}`;
    case "logging": return `LOG SET ${pad2(v.setNumber)}`;
    case "resting": return "REST";
    case "done": return "DONE";
  }
}

function openStatus(v: ViewState): string {
  switch (v.phase) {
    case "idle": return "TAP START SESSION";
    case "working": return "TAP DONE SET WHEN FINISHED";
    case "logging": return "DRAG DIAL FOR REPS · TAP CONFIRM";
    case "resting":
      return v.totalReps === 0
        ? "REST · TAP START SET WHEN READY"
        : `${v.totalReps} REPS · ${pad2(v.setsCompleted)} SETS`;
    case "done":
      return `${v.totalReps} REPS · ${pad2(v.setsCompleted)} SETS · ${formatClock(v.totalElapsedMs)}`;
  }
}

function openPrimaryLabel(v: ViewState): string {
  switch (v.phase) {
    case "idle": return "START SESSION";
    case "working": return "DONE SET";
    case "logging": return `CONFIRM ${pad2(dialReps)}`;
    case "resting": return "START SET";
    case "done": return "NEW SESSION";
  }
}

function applyOpenDialFill(v: ViewState) {
  const fill = setsDialFillEl;
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

function renderOpenTally(sets: ReadonlyArray<SetRecord>) {
  if (sets.length === 0) {
    setsTallyEl.innerHTML = `<div class="tally-empty">No sets logged yet</div>`;
    return;
  }
  setsTallyEl.innerHTML = sets
    .map(
      (s, i) =>
        `<div class="tally-set"><span class="tally-set-n">${pad2(i + 1)}</span><span class="tally-set-reps">${s.reps}</span></div>`,
    )
    .join("");
}

// ───────────────────────── EMOM RENDER ─────────────────────────

function renderEmom(v: EmomViewState) {
  emomBigEl.textContent = emomBigText(v);
  emomBigEl.classList.toggle("timer", false);
  emomBigEl.classList.toggle("count", v.phase === "working");
  emomBigEl.classList.toggle("done-state", v.phase === "done");

  emomEyebrowEl.textContent = emomEyebrow(v);
  emomDialStatusEl.textContent = emomStatus(v);
  emomRepStepperEl.classList.toggle("hidden", v.phase !== "working");
  emomConfigEl.classList.toggle("locked", v.phase === "working");
  (emomDialCenterEl.parentElement as HTMLElement).classList.toggle(
    "grab-hint",
    v.phase === "working",
  );

  applyEmomDialFill(v);

  emomElapsedEl.textContent = formatClock(v.totalElapsedMs);

  if (v.sets.length !== prevEmomSetsCount || v.phase === "idle" || v.phase === "done") {
    renderEmomTally(v.sets, v.totalMinutes);
    prevEmomSetsCount = v.sets.length;
  }

  syncBandSelectors();

  emomPrimaryBtn.className = `primary ${v.phase === "working" ? "working" : v.phase === "done" ? "done" : "idle"}`;
  emomPrimaryBtn.textContent = emomPrimaryLabel(v);
  emomPrimaryBtn.disabled = v.phase === "working";

  emomEndBtn.classList.toggle("hidden", v.phase !== "working");
  emomEndBtn.disabled = v.phase !== "working";

  emomResetBtn.disabled = v.phase === "idle";
}

function emomBigText(v: EmomViewState): string {
  switch (v.phase) {
    case "idle": return pad2(v.targetRepsPerMin);
    case "working": return pad2(v.currentMinuteReps);
    case "done": return String(v.totalReps);
  }
}

function emomEyebrow(v: EmomViewState): string {
  switch (v.phase) {
    case "idle": return "EMOM · READY";
    case "working": return `MIN ${pad2(v.minuteNumber)} / ${pad2(v.totalMinutes)}`;
    case "done": return "EMOM DONE";
  }
}

function emomStatus(v: EmomViewState): string {
  switch (v.phase) {
    case "idle":
      return `${v.targetRepsPerMin} REPS × ${v.totalMinutes} MIN · TAP START`;
    case "working":
      return `${formatClock(v.minuteRemainingMs)} TO NEXT MIN · DIAL REPS`;
    case "done":
      return `${v.totalReps} REPS · ${v.setsCompleted}/${v.totalMinutes} MIN · ${formatClock(v.totalElapsedMs)}`;
  }
}

function emomPrimaryLabel(v: EmomViewState): string {
  switch (v.phase) {
    case "idle": return "START EMOM";
    case "working": return `MIN ${pad2(v.minuteNumber)}`;
    case "done": return "NEW EMOM";
  }
}

function applyEmomDialFill(v: EmomViewState) {
  const fill = emomDialFillEl;
  fill.classList.remove("idle", "working", "logging", "resting", "done");
  fill.classList.add(v.phase === "working" ? "resting" : v.phase);

  let offset = DIAL_PATH_LENGTH;
  if (v.phase === "working") {
    const frac = (v.minuteElapsedMs % LAP_MS) / LAP_MS;
    offset = (1 - frac) * DIAL_PATH_LENGTH;
  }
  fill.setAttribute("stroke-dashoffset", offset.toFixed(2));
}

function renderEmomTally(sets: ReadonlyArray<EmomSetRecord>, totalMinutes: number) {
  if (sets.length === 0) {
    emomTallyEl.innerHTML = `<div class="tally-empty">${totalMinutes} min EMOM — no minutes logged yet</div>`;
    return;
  }
  emomTallyEl.innerHTML = sets
    .map(
      (s, i) =>
        `<div class="tally-set"><span class="tally-set-n">M${pad2(i + 1)}</span><span class="tally-set-reps">${s.reps}</span></div>`,
    )
    .join("");
}

// ───────────────────────── LOG / EXPORT ─────────────────────────

type ExportKind = "share-png" | "ask-claude" | "copy-prompt";
let exportBusy = false;

async function runExport(
  kind: ExportKind,
  btn: HTMLButtonElement,
  session: Session,
): Promise<void> {
  if (exportBusy) return;
  const exportData = toExportSession(session);
  exportBusy = true;
  const row = btn.closest<HTMLElement>(".log-actions");
  row?.classList.add("busy");
  btn.disabled = true;
  setLogStatus(workingLabel(kind), "info");
  try {
    if (kind === "share-png") setLogStatus(pngMsg(await shareSessionPng(exportData)), "ok");
    else if (kind === "ask-claude") setLogStatus(claudeMsg(await analyzeSessionInClaude(exportData)), "ok");
    else setLogStatus(copyMsg(await copySessionPrompt(exportData)), "ok");
  } catch {
    setLogStatus("Something went wrong — try again.", "err");
  } finally {
    exportBusy = false;
    row?.classList.remove("busy");
    btn.disabled = false;
  }
}

function workingLabel(kind: ExportKind): string {
  switch (kind) {
    case "share-png": return "Rendering PNG…";
    case "ask-claude": return "Opening Claude…";
    case "copy-prompt": return "Copying prompt…";
  }
}

function pngMsg(r: ShareResult): string {
  return r === "shared"
    ? "Shared — pick where to send it."
    : "Saved as PNG to your downloads.";
}

function claudeMsg(r: AnalyzeResult): string {
  switch (r) {
    case "shared": return "Shared — pick Claude from the sheet.";
    case "copied-opened": return "Prompt copied — paste it into the Claude tab.";
    case "copied": return "Prompt copied — paste it into Claude.";
    case "downloaded": return "Saved the prompt as a Markdown file.";
  }
}

function copyMsg(r: CopyResult): string {
  return r === "copied"
    ? "Copied — paste into any AI (Claude, ChatGPT, Gemini…)."
    : "Clipboard unavailable — saved as Markdown instead.";
}

function setLogStatus(message: string, kind: "ok" | "err" | "info"): void {
  const el = document.getElementById("logStatus");
  if (!el) return;
  el.textContent = message;
  el.className = `log-status log-status-${kind}`;
}

function toExportSession(s: Session): SessionData {
  const base = {
    date: s.date,
    band: s.band,
    bandLabel: bandTitle(s.band),
    bandColor: bandColor(s.band),
    elapsedMs: s.elapsedMs,
    totalReps: s.totalReps,
    bodyWeightKg: currentBodyWeight,
    weightUnit: currentWeightUnit,
  };
  if (s.type === "emom") {
    return {
      ...base,
      type: "emom",
      targetRepsPerMin: s.targetRepsPerMin,
      targetMinutes: s.targetMinutes,
      sets: s.sets,
    };
  }
  return { ...base, type: "open", sets: s.sets };
}

// ───────────────────────── SESSION RECORD ─────────────────────────

function recordOpenSession(v: ViewState) {
  const session: OpenSession = {
    type: "open",
    date: new Date().toISOString(),
    band: currentBand,
    elapsedMs: Math.round(v.totalElapsedMs),
    totalReps: v.totalReps,
    sets: v.sets.map((s) => ({ ...s })),
  };
  pushSession(session);
}

function recordEmomSession(v: EmomViewState) {
  const session: EmomSession = {
    type: "emom",
    date: new Date().toISOString(),
    band: currentBand,
    elapsedMs: Math.round(v.totalElapsedMs),
    totalReps: v.totalReps,
    targetRepsPerMin: v.targetRepsPerMin,
    targetMinutes: v.totalMinutes,
    sets: v.sets.map((s) => ({ ...s })),
  };
  pushSession(session);
}

function pushSession(session: Session) {
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
    selectedSessionId = null;
    logEl.innerHTML = `<div class="log-empty">No sessions logged yet — finish a workout to start your log.</div>`;
    return;
  }

  if (selectedSessionId) {
    const session = findSession(selectedSessionId);
    if (session) {
      logEl.innerHTML = renderSessionDetailHtml(session);
      return;
    }
    selectedSessionId = null;
  }

  const recent = sessions.slice(0, LOG_DISPLAY_LIMIT);
  const rows = recent
    .map((s) => {
      const typeChip = s.type === "emom" ? "EMOM" : "OPEN";
      const detail =
        s.type === "emom"
          ? `${s.sets.length}/${s.targetMinutes} min`
          : `${s.sets.length} sets`;
      return `
      <li class="log-item">
        <button type="button" class="log-item-btn" data-open-session="${escapeAttr(s.date)}" aria-label="Open ${typeChip.toLowerCase()} session from ${formatLogDate(s.date)}">
          <span class="log-band${s.band === "none" ? " none" : ""}" style="--band:${bandColor(s.band)}" title="${bandTitle(s.band)}"></span>
          <span class="log-type log-type-${s.type}">${typeChip}</span>
          <span class="log-reps">${s.totalReps}</span>
          <span class="log-pace" title="${s.type === "emom" ? "Minutes completed" : "Sets"}">${detail}</span>
          <span class="log-date">${formatLogDate(s.date)}</span>
          <span class="log-time">${formatClock(s.elapsedMs)}</span>
          <span class="log-chevron" aria-hidden="true">›</span>
        </button>
      </li>`;
    })
    .join("");

  const more =
    sessions.length > LOG_DISPLAY_LIMIT
      ? `<div class="log-more">+${sessions.length - LOG_DISPLAY_LIMIT} earlier</div>`
      : "";

  const latestSessionId = sessions[0]?.date ?? "";
  logEl.innerHTML = `
    <div class="log-export">
      <div class="log-export-head">
        <span class="log-export-caption">Latest workout</span>
        <span class="log-export-hint">Send to Claude for coaching</span>
      </div>
      <div class="log-actions">
        <button type="button" class="log-action" data-export="png" data-session-id="${escapeAttr(latestSessionId)}" aria-label="Share latest workout as PNG image">Share PNG</button>
        <button type="button" class="log-action accent" data-export="claude" data-session-id="${escapeAttr(latestSessionId)}" aria-label="Ask Claude about latest workout">Ask Claude ▸</button>
        <button type="button" class="log-action" data-export="copy" data-session-id="${escapeAttr(latestSessionId)}" aria-label="Copy latest workout as prompt for any AI">Copy prompt</button>
      </div>
      <p class="log-status" id="logStatus" role="status" aria-live="polite"></p>
    </div>
    <div class="log-head">
      <span class="log-title">Session Log</span>
      <button type="button" class="log-clear" id="clearLogBtn">Clear</button>
    </div>
    <ol class="log-list">${rows}</ol>
    ${more}
  `;
}

function renderSessionDetailHtml(s: Session): string {
  const typeChip = s.type === "emom" ? "EMOM" : "OPEN";
  const date = new Date(s.date);
  const dateLabel = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);

  const statCards =
    s.type === "emom"
      ? [
          { label: "REPS", value: String(s.totalReps) },
          { label: "MINUTES", value: `${s.sets.length}/${s.targetMinutes}` },
          { label: "TIME", value: formatClock(s.elapsedMs) },
        ]
      : [
          { label: "REPS", value: String(s.totalReps) },
          { label: "SETS", value: String(s.sets.length) },
          { label: "TIME", value: formatClock(s.elapsedMs) },
        ];

  const statsHtml = statCards
    .map(
      (c) =>
        `<div class="detail-stat"><div class="detail-stat-label">${c.label}</div><div class="detail-stat-value">${c.value}</div></div>`,
    )
    .join("");

  let breakdown: string;
  if (s.type === "emom") {
    const target = s.targetRepsPerMin;
    const rows = s.sets
      .map((set, i) => {
        const diff = set.reps - target;
        const tag =
          diff >= 0
            ? `<span class="detail-row-hit">✓ HIT</span>`
            : `<span class="detail-row-miss">−${-diff}</span>`;
        return `<tr><td>${pad2(i + 1)}</td><td class="detail-row-reps">${set.reps}</td><td>${tag}</td></tr>`;
      })
      .join("");
    breakdown = `
      <table class="detail-table">
        <thead><tr><th>MIN</th><th>REPS</th><th class="detail-th-right">vs TARGET ${target}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="detail-foot">Target ${target} reps/min × ${s.targetMinutes} min</p>
    `;
  } else {
    const rows = s.sets
      .map((set, i) => {
        const rest = i < s.sets.length - 1 ? formatClock(set.restMsAfter) : "—";
        return `<tr><td>${pad2(i + 1)}</td><td class="detail-row-reps">${set.reps}</td><td>${formatClock(set.workMs)}</td><td>${rest}</td></tr>`;
      })
      .join("");
    breakdown = `
      <table class="detail-table">
        <thead><tr><th>SET</th><th>REPS</th><th>WORK</th><th class="detail-th-right">REST AFTER</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  return `
    <button type="button" class="log-back" id="logBackBtn" aria-label="Back to log list">← Back to log</button>
    <section class="session-detail">
      <header class="detail-head">
        <span class="log-type log-type-${s.type}">${typeChip}</span>
        <span class="detail-date">${dateLabel}</span>
        <span class="detail-band${s.band === "none" ? " none" : ""}" style="--band:${bandColor(s.band)}" title="${bandTitle(s.band)}"></span>
      </header>
      <div class="detail-stats">${statsHtml}</div>
      <div class="detail-breakdown">${breakdown}</div>
    </section>
    <div class="log-export">
      <div class="log-export-head">
        <span class="log-export-caption">This workout</span>
        <span class="log-export-hint">Send to Claude for coaching</span>
      </div>
      <div class="log-actions">
        <button type="button" class="log-action" data-export="png" data-session-id="${escapeAttr(s.date)}" aria-label="Share this workout as PNG image">Share PNG</button>
        <button type="button" class="log-action accent" data-export="claude" data-session-id="${escapeAttr(s.date)}" aria-label="Ask Claude about this workout">Ask Claude ▸</button>
        <button type="button" class="log-action" data-export="copy" data-session-id="${escapeAttr(s.date)}" aria-label="Copy this workout as prompt for any AI">Copy prompt</button>
      </div>
      <p class="log-status" id="logStatus" role="status" aria-live="polite"></p>
    </div>
  `;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

// ───────────────────────── DIAL MARKUP ─────────────────────────

function renderBandSelectorHtml(scope: "sets" | "emom"): string {
  return `
    <section class="bands" id="bandSelector-${scope}" role="radiogroup" aria-label="Resistance band">
      <div class="bands-caption">Resistance band</div>
      <div class="bands-row">
        ${BANDS.map(
          (b) =>
            `<button type="button" role="radio" class="band-chip" data-band="${b.id}" aria-checked="${b.id === currentBand}" aria-label="${bandTitle(b.id)}" style="--band:${b.color}"><span class="band-dot${b.id === "none" ? " none" : ""}"></span><span class="band-name">${b.label}</span></button>`,
        ).join("")}
      </div>
    </section>
  `;
}

function renderDialHtml(scope: "sets" | "emom"): string {
  return `
    <div class="dial-stage">
      <svg class="dial" id="dial-${scope}" viewBox="0 0 340 340" aria-hidden="true">
        <defs>
          <radialGradient id="dialFace-${scope}" cx="50%" cy="40%" r="66%">
            <stop offset="0%" stop-color="#f4eddc" />
            <stop offset="58%" stop-color="#e9dec3" />
            <stop offset="100%" stop-color="#d6c79f" />
          </radialGradient>
          <filter id="dialEmboss-${scope}" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#15110d" flood-opacity="0.17" />
          </filter>
        </defs>
        <circle class="dial-face" cx="170" cy="170" r="154" fill="url(#dialFace-${scope})" filter="url(#dialEmboss-${scope})" />
        <circle class="dial-rim" cx="170" cy="170" r="154" />
        <g class="dial-ticks" id="dialTicks-${scope}"></g>
        <g class="dial-numerals" id="dialNumerals-${scope}"></g>
        <circle class="dial-track" cx="170" cy="170" r="138" />
        <circle
          class="dial-fill idle"
          id="dialFill-${scope}"
          cx="170"
          cy="170"
          r="138"
          pathLength="${DIAL_PATH_LENGTH}"
          stroke-dasharray="${DIAL_PATH_LENGTH} ${DIAL_PATH_LENGTH}"
          stroke-dashoffset="${DIAL_PATH_LENGTH}"
        />
        <circle
          class="dial-knob-arc"
          id="dialKnobArc-${scope}"
          cx="170"
          cy="170"
          r="116"
          pathLength="${DIAL_PATH_LENGTH}"
          stroke-dasharray="${DIAL_PATH_LENGTH} ${DIAL_PATH_LENGTH}"
          stroke-dashoffset="${DIAL_PATH_LENGTH}"
        />
        <circle class="dial-grip" id="dialGrip-${scope}" cx="170" cy="170" r="16" />
      </svg>
      <div class="dial-center" id="dialCenter-${scope}">
        <div class="eyebrow" id="eyebrow-${scope}">READY</div>
        <div class="big-number" id="big-${scope}">0:00</div>
        <div class="dial-status" id="dialStatus-${scope}">PRESS START SESSION</div>
        <div class="rep-stepper hidden" id="repStepper-${scope}" aria-label="Reps">
          <button type="button" class="step-btn" data-step="-1" aria-label="Decrease reps">−</button>
          <button type="button" class="step-btn" data-step="1" aria-label="Increase reps">+</button>
        </div>
      </div>
    </div>
  `;
}

function pulseBig(centerEl: HTMLElement) {
  centerEl.classList.remove("pulse-now");
  void centerEl.offsetWidth;
  centerEl.classList.add("pulse-now");
}

function buildDialTicks(scope: "sets" | "emom") {
  const ticksGroup = byId(`dialTicks-${scope}`);
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

function renderDialNumerals(scope: "sets" | "emom") {
  const numeralsGroup = byId(`dialNumerals-${scope}`);
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

function loadEmomConfig(): { reps: number; minutes: EmomDuration } {
  try {
    const raw = localStorage.getItem(EMOM_CONFIG_KEY);
    if (!raw) return { reps: DEFAULT_EMOM_REPS, minutes: DEFAULT_EMOM_MINUTES };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { reps: DEFAULT_EMOM_REPS, minutes: DEFAULT_EMOM_MINUTES };
    }
    const c = parsed as Record<string, unknown>;
    const reps =
      typeof c.reps === "number" && c.reps >= MIN_EMOM_REPS && c.reps <= MAX_EMOM_REPS
        ? Math.floor(c.reps)
        : DEFAULT_EMOM_REPS;
    const minutes = EMOM_DURATIONS.includes(c.minutes as EmomDuration)
      ? (c.minutes as EmomDuration)
      : DEFAULT_EMOM_MINUTES;
    return { reps, minutes };
  } catch {
    return { reps: DEFAULT_EMOM_REPS, minutes: DEFAULT_EMOM_MINUTES };
  }
}

function saveEmomConfig(cfg: { reps: number; minutes: EmomDuration }) {
  try {
    localStorage.setItem(EMOM_CONFIG_KEY, JSON.stringify(cfg));
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

  const type: SessionType = s.type === "emom" ? "emom" : "open";

  if (type === "emom") {
    const targetRepsPerMin =
      typeof s.targetRepsPerMin === "number" ? Math.max(0, Math.floor(s.targetRepsPerMin)) : 0;
    const targetMinutes =
      typeof s.targetMinutes === "number" ? Math.max(1, Math.floor(s.targetMinutes)) : 10;
    const sets: EmomSetRecord[] = Array.isArray(s.sets)
      ? s.sets.flatMap((raw): EmomSetRecord[] => {
          if (typeof raw !== "object" || raw === null) return [];
          const r = raw as Record<string, unknown>;
          if (typeof r.reps !== "number") return [];
          return [
            {
              reps: r.reps,
              workMs: typeof r.workMs === "number" ? r.workMs : 0,
            },
          ];
        })
      : [];
    const totalReps =
      typeof s.totalReps === "number"
        ? s.totalReps
        : sets.reduce((sum, set) => sum + set.reps, 0);
    return {
      type: "emom",
      date: s.date,
      band: s.band as BandId,
      elapsedMs: s.elapsedMs,
      totalReps,
      targetRepsPerMin,
      targetMinutes,
      sets,
    };
  }

  const sets: SetRecord[] = Array.isArray(s.sets)
    ? s.sets.flatMap((raw): SetRecord[] => {
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
      })
    : [];
  const totalReps =
    typeof s.totalReps === "number"
      ? s.totalReps
      : sets.reduce((sum, set) => sum + set.reps, 0);
  return {
    type: "open",
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

function bandColor(id: BandId): string {
  return (BANDS.find((b) => b.id === id) ?? BANDS[0]).color;
}

function bandLabel(id: BandId): string {
  return (BANDS.find((b) => b.id === id) ?? BANDS[0]).label;
}

function bandTitle(id: BandId): string {
  return id === "none" ? "No band" : `${bandLabel(id)} band`;
}

function tabLabel(t: TabId): string {
  switch (t) {
    case "sets": return "Sets";
    case "emom": return "EMOM";
    case "log": return "Log";
    case "settings": return "Settings";
  }
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
