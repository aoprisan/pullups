export type Phase = "idle" | "ready" | "resting" | "paused" | "done";

export interface ViewState {
  phase: Phase;
  totalReps: number;
  repsCompleted: number;
  currentRepNumber: number;
  secondsRemainingInRest: number;
  restElapsedMs: number;
  restTotalMs: number;
  totalElapsedMs: number;
  newRepReadyIndex: number | null;
  newRestCountdownTickIndex: number | null;
}

export interface TimerConfig {
  totalReps: number;
  intervalMs: number;
}

const DEFAULT_CONFIG: TimerConfig = {
  totalReps: 20,
  intervalMs: 60_000,
};

export class PullupTimer {
  private readonly cfg: TimerConfig;
  private phase: Phase = "idle";
  private repsCompleted = 0;
  private startedAtMs = 0;
  private restStartMs = 0;
  private pausedAtMs = 0;
  private finishedAtMs = 0;
  private lastRestTickIndex = -1;

  constructor(config: Partial<TimerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  get totalReps(): number {
    return this.cfg.totalReps;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  get completedReps(): number {
    return this.repsCompleted;
  }

  start(now: number): void {
    if (this.phase !== "idle" && this.phase !== "done") return;
    this.repsCompleted = 0;
    this.startedAtMs = now;
    this.restStartMs = 0;
    this.pausedAtMs = 0;
    this.finishedAtMs = 0;
    this.lastRestTickIndex = -1;
    this.phase = "ready";
  }

  repDone(now: number): void {
    if (this.phase !== "ready") return;
    this.repsCompleted += 1;
    if (this.repsCompleted >= this.cfg.totalReps) {
      this.finishedAtMs = now;
      this.phase = "done";
      return;
    }
    this.restStartMs = now;
    this.lastRestTickIndex = -1;
    this.phase = "resting";
  }

  pause(now: number): void {
    if (this.phase !== "resting") return;
    this.pausedAtMs = now;
    this.phase = "paused";
  }

  resume(now: number): void {
    if (this.phase !== "paused") return;
    const drift = now - this.pausedAtMs;
    this.startedAtMs += drift;
    this.restStartMs += drift;
    this.phase = "resting";
  }

  reset(): void {
    this.phase = "idle";
    this.repsCompleted = 0;
    this.startedAtMs = 0;
    this.restStartMs = 0;
    this.pausedAtMs = 0;
    this.finishedAtMs = 0;
    this.lastRestTickIndex = -1;
  }

  tick(now: number): ViewState {
    const total = this.cfg.totalReps;
    const intervalMs = this.cfg.intervalMs;

    if (this.phase === "idle") {
      return view({
        phase: "idle",
        total,
        repsCompleted: 0,
        currentRep: 1,
        restElapsed: 0,
        restTotal: intervalMs,
        totalElapsed: 0,
      });
    }

    if (this.phase === "done") {
      return view({
        phase: "done",
        total,
        repsCompleted: total,
        currentRep: total,
        restElapsed: 0,
        restTotal: intervalMs,
        totalElapsed: Math.max(0, this.finishedAtMs - this.startedAtMs),
      });
    }

    if (this.phase === "ready") {
      return view({
        phase: "ready",
        total,
        repsCompleted: this.repsCompleted,
        currentRep: this.repsCompleted + 1,
        restElapsed: 0,
        restTotal: intervalMs,
        totalElapsed: now - this.startedAtMs,
      });
    }

    if (this.phase === "paused") {
      const restElapsed = Math.min(intervalMs, Math.max(0, this.pausedAtMs - this.restStartMs));
      return view({
        phase: "paused",
        total,
        repsCompleted: this.repsCompleted,
        currentRep: this.repsCompleted + 1,
        restElapsed,
        restTotal: intervalMs,
        totalElapsed: this.pausedAtMs - this.startedAtMs,
      });
    }

    const restElapsed = now - this.restStartMs;
    if (restElapsed >= intervalMs) {
      this.phase = "ready";
      this.lastRestTickIndex = -1;
      const cueIndex = this.repsCompleted + 1;
      return view({
        phase: "ready",
        total,
        repsCompleted: this.repsCompleted,
        currentRep: cueIndex,
        restElapsed: intervalMs,
        restTotal: intervalMs,
        totalElapsed: now - this.startedAtMs,
        newRepReadyIndex: cueIndex,
      });
    }

    const remainingMs = intervalMs - restElapsed;
    const remainingS = Math.ceil(remainingMs / 1000);

    let newRestCountdownTickIndex: number | null = null;
    if (remainingS <= 3 && remainingS > 0) {
      const tickIndex = 3 - remainingS;
      if (tickIndex > this.lastRestTickIndex) {
        this.lastRestTickIndex = tickIndex;
        newRestCountdownTickIndex = tickIndex;
      }
    }

    return view({
      phase: "resting",
      total,
      repsCompleted: this.repsCompleted,
      currentRep: this.repsCompleted + 1,
      restElapsed,
      restTotal: intervalMs,
      totalElapsed: now - this.startedAtMs,
      newRestCountdownTickIndex,
    });
  }
}

interface ViewArgs {
  phase: Phase;
  total: number;
  repsCompleted: number;
  currentRep: number;
  restElapsed: number;
  restTotal: number;
  totalElapsed: number;
  newRepReadyIndex?: number | null;
  newRestCountdownTickIndex?: number | null;
}

function view(a: ViewArgs): ViewState {
  const remainingMs = Math.max(0, a.restTotal - a.restElapsed);
  return {
    phase: a.phase,
    totalReps: a.total,
    repsCompleted: a.repsCompleted,
    currentRepNumber: Math.min(a.total, Math.max(1, a.currentRep)),
    secondsRemainingInRest: Math.ceil(remainingMs / 1000),
    restElapsedMs: a.restElapsed,
    restTotalMs: a.restTotal,
    totalElapsedMs: Math.max(0, a.totalElapsed),
    newRepReadyIndex: a.newRepReadyIndex ?? null,
    newRestCountdownTickIndex: a.newRestCountdownTickIndex ?? null,
  };
}
