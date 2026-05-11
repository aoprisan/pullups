export type Phase = "idle" | "countdown" | "running" | "paused" | "done";

export interface ViewState {
  phase: Phase;
  totalReps: number;
  repsCued: number;
  countdownSecondsRemaining: number;
  secondsToNextRep: number;
  elapsedMs: number;
  totalMs: number;
  newRepCueIndex: number | null;
  newCountdownTickIndex: number | null;
}

export interface TimerConfig {
  totalReps: number;
  intervalMs: number;
  countdownMs: number;
}

const DEFAULT_CONFIG: TimerConfig = {
  totalReps: 20,
  intervalMs: 60_000,
  countdownMs: 5_000,
};

export class EmomTimer {
  private readonly cfg: TimerConfig;
  private phase: Phase = "idle";
  private countdownStartMs = 0;
  private runStartMs = 0;
  private pausedAtMs = 0;
  private lastRepCued = 0;
  private lastCountdownTick = -1;

  constructor(config: Partial<TimerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  get totalReps(): number {
    return this.cfg.totalReps;
  }

  get totalDurationMs(): number {
    return (this.cfg.totalReps - 1) * this.cfg.intervalMs;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  start(now: number): void {
    if (this.phase !== "idle" && this.phase !== "done") return;
    this.phase = "countdown";
    this.countdownStartMs = now;
    this.runStartMs = now + this.cfg.countdownMs;
    this.lastRepCued = 0;
    this.lastCountdownTick = -1;
  }

  pause(now: number): void {
    if (this.phase !== "running" && this.phase !== "countdown") return;
    this.pausedAtMs = now;
    this.phase = "paused";
  }

  resume(now: number): void {
    if (this.phase !== "paused") return;
    const drift = now - this.pausedAtMs;
    this.countdownStartMs += drift;
    this.runStartMs += drift;
    this.phase = now < this.runStartMs ? "countdown" : "running";
  }

  reset(): void {
    this.phase = "idle";
    this.countdownStartMs = 0;
    this.runStartMs = 0;
    this.pausedAtMs = 0;
    this.lastRepCued = 0;
    this.lastCountdownTick = -1;
  }

  tick(now: number): ViewState {
    const totalMs = this.totalDurationMs;

    if (this.phase === "idle") {
      return this.viewIdle(totalMs);
    }

    if (this.phase === "paused") {
      return this.viewPaused(totalMs);
    }

    if (this.phase === "countdown") {
      return this.advanceCountdown(now, totalMs);
    }

    if (this.phase === "running") {
      return this.advanceRunning(now, totalMs);
    }

    return this.viewDone(totalMs);
  }

  private viewIdle(totalMs: number): ViewState {
    return {
      phase: "idle",
      totalReps: this.cfg.totalReps,
      repsCued: 0,
      countdownSecondsRemaining: Math.ceil(this.cfg.countdownMs / 1000),
      secondsToNextRep: 0,
      elapsedMs: 0,
      totalMs,
      newRepCueIndex: null,
      newCountdownTickIndex: null,
    };
  }

  private viewPaused(totalMs: number): ViewState {
    const refMs = this.pausedAtMs;
    if (refMs < this.runStartMs) {
      const remainingMs = Math.max(0, this.runStartMs - refMs);
      return {
        phase: "paused",
        totalReps: this.cfg.totalReps,
        repsCued: 0,
        countdownSecondsRemaining: Math.ceil(remainingMs / 1000),
        secondsToNextRep: Math.ceil(remainingMs / 1000),
        elapsedMs: 0,
        totalMs,
        newRepCueIndex: null,
        newCountdownTickIndex: null,
      };
    }
    const elapsedMs = Math.min(totalMs, refMs - this.runStartMs);
    const repsCued = Math.min(this.cfg.totalReps, Math.floor(elapsedMs / this.cfg.intervalMs) + 1);
    const nextRepAtMs = repsCued * this.cfg.intervalMs;
    const secondsToNextRep = Math.max(0, Math.ceil((nextRepAtMs - elapsedMs) / 1000));
    return {
      phase: "paused",
      totalReps: this.cfg.totalReps,
      repsCued,
      countdownSecondsRemaining: 0,
      secondsToNextRep,
      elapsedMs,
      totalMs,
      newRepCueIndex: null,
      newCountdownTickIndex: null,
    };
  }

  private advanceCountdown(now: number, totalMs: number): ViewState {
    const remainingMs = this.runStartMs - now;
    if (remainingMs <= 0) {
      this.phase = "running";
      return this.advanceRunning(now, totalMs);
    }

    const remainingS = Math.ceil(remainingMs / 1000);
    const tickIndex = Math.ceil(this.cfg.countdownMs / 1000) - remainingS;
    let newCountdownTickIndex: number | null = null;
    if (tickIndex > this.lastCountdownTick) {
      this.lastCountdownTick = tickIndex;
      newCountdownTickIndex = tickIndex;
    }

    return {
      phase: "countdown",
      totalReps: this.cfg.totalReps,
      repsCued: 0,
      countdownSecondsRemaining: remainingS,
      secondsToNextRep: remainingS,
      elapsedMs: 0,
      totalMs,
      newRepCueIndex: null,
      newCountdownTickIndex,
    };
  }

  private advanceRunning(now: number, totalMs: number): ViewState {
    const rawElapsed = now - this.runStartMs;
    const elapsedMs = Math.max(0, Math.min(totalMs, rawElapsed));

    const repsCued = Math.min(
      this.cfg.totalReps,
      Math.floor(rawElapsed / this.cfg.intervalMs) + 1,
    );

    let newRepCueIndex: number | null = null;
    if (repsCued > this.lastRepCued) {
      this.lastRepCued = repsCued;
      newRepCueIndex = repsCued;
    }

    const nextRepAtMs = repsCued * this.cfg.intervalMs;
    const secondsToNextRep =
      repsCued >= this.cfg.totalReps ? 0 : Math.max(0, Math.ceil((nextRepAtMs - rawElapsed) / 1000));

    if (repsCued >= this.cfg.totalReps && rawElapsed >= totalMs) {
      this.phase = "done";
    }

    return {
      phase: this.phase,
      totalReps: this.cfg.totalReps,
      repsCued,
      countdownSecondsRemaining: 0,
      secondsToNextRep,
      elapsedMs,
      totalMs,
      newRepCueIndex,
      newCountdownTickIndex: null,
    };
  }

  private viewDone(totalMs: number): ViewState {
    return {
      phase: "done",
      totalReps: this.cfg.totalReps,
      repsCued: this.cfg.totalReps,
      countdownSecondsRemaining: 0,
      secondsToNextRep: 0,
      elapsedMs: totalMs,
      totalMs,
      newRepCueIndex: null,
      newCountdownTickIndex: null,
    };
  }
}
