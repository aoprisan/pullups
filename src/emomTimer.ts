export type EmomPhase = "idle" | "working" | "done";

export interface EmomSetRecord {
  reps: number;
  workMs: number;
}

export interface EmomViewState {
  phase: EmomPhase;
  minuteNumber: number;
  totalMinutes: number;
  targetRepsPerMin: number;
  currentMinuteReps: number;
  setsCompleted: number;
  totalReps: number;
  minuteElapsedMs: number;
  minuteRemainingMs: number;
  totalElapsedMs: number;
  sets: ReadonlyArray<EmomSetRecord>;
  enteredPhase: EmomPhase | null;
  /** 1-based minute number that just started this tick (for cue beep); null otherwise. */
  minuteCueAt: number | null;
}

const MINUTE_MS = 60_000;
const MAX_REPS = 99;
const MAX_MINUTES = 60;

export class EmomTimer {
  private phase: EmomPhase = "idle";
  private totalMinutes = 10;
  private targetRepsPerMin = 5;
  private startedAtMs = 0;
  private endedAtMs = 0;
  private sets: EmomSetRecord[] = [];
  private currentMinuteReps = 0;
  private justEnteredPhase: EmomPhase | null = null;
  private pendingMinuteCue: number | null = null;

  get currentPhase(): EmomPhase {
    return this.phase;
  }

  get config(): { totalMinutes: number; targetRepsPerMin: number } {
    return { totalMinutes: this.totalMinutes, targetRepsPerMin: this.targetRepsPerMin };
  }

  setConfig(totalMinutes: number, targetRepsPerMin: number): boolean {
    if (this.phase !== "idle" && this.phase !== "done") return false;
    this.totalMinutes = clamp(Math.floor(totalMinutes), 1, MAX_MINUTES);
    this.targetRepsPerMin = clamp(Math.floor(targetRepsPerMin), 0, MAX_REPS);
    return true;
  }

  start(now: number): void {
    if (this.phase !== "idle" && this.phase !== "done") return;
    this.phase = "working";
    this.startedAtMs = now;
    this.endedAtMs = 0;
    this.sets = [];
    this.currentMinuteReps = this.targetRepsPerMin;
    this.justEnteredPhase = "working";
    this.pendingMinuteCue = 1;
  }

  adjustReps(delta: number): void {
    if (this.phase !== "working") return;
    this.currentMinuteReps = clamp(this.currentMinuteReps + delta, 0, MAX_REPS);
  }

  end(now: number): void {
    if (this.phase !== "working") return;
    const elapsedTotal = Math.max(0, now - this.startedAtMs);
    const completedFromBoundaries = Math.floor(elapsedTotal / MINUTE_MS);
    while (this.sets.length < completedFromBoundaries && this.sets.length < this.totalMinutes) {
      this.sets.push({ reps: this.currentMinuteReps, workMs: MINUTE_MS });
      this.currentMinuteReps = this.targetRepsPerMin;
    }
    if (this.sets.length < this.totalMinutes) {
      const partialMs = elapsedTotal - this.sets.length * MINUTE_MS;
      if (partialMs > 1000) {
        this.sets.push({ reps: this.currentMinuteReps, workMs: partialMs });
      }
    }
    this.endedAtMs = now;
    this.phase = "done";
    this.justEnteredPhase = "done";
  }

  reset(): void {
    this.phase = "idle";
    this.startedAtMs = 0;
    this.endedAtMs = 0;
    this.sets = [];
    this.currentMinuteReps = 0;
    this.justEnteredPhase = null;
    this.pendingMinuteCue = null;
  }

  tick(now: number): EmomViewState {
    const entered = this.justEnteredPhase;
    this.justEnteredPhase = null;

    if (this.phase === "idle") {
      const cue = this.pendingMinuteCue;
      this.pendingMinuteCue = null;
      return {
        phase: "idle",
        minuteNumber: 0,
        totalMinutes: this.totalMinutes,
        targetRepsPerMin: this.targetRepsPerMin,
        currentMinuteReps: 0,
        setsCompleted: 0,
        totalReps: 0,
        minuteElapsedMs: 0,
        minuteRemainingMs: MINUTE_MS,
        totalElapsedMs: 0,
        sets: this.sets,
        enteredPhase: entered,
        minuteCueAt: cue,
      };
    }

    if (this.phase === "done") {
      const cue = this.pendingMinuteCue;
      this.pendingMinuteCue = null;
      return {
        phase: "done",
        minuteNumber: this.sets.length,
        totalMinutes: this.totalMinutes,
        targetRepsPerMin: this.targetRepsPerMin,
        currentMinuteReps: 0,
        setsCompleted: this.sets.length,
        totalReps: sumReps(this.sets),
        minuteElapsedMs: 0,
        minuteRemainingMs: 0,
        totalElapsedMs: Math.max(0, this.endedAtMs - this.startedAtMs),
        sets: this.sets,
        enteredPhase: entered,
        minuteCueAt: cue,
      };
    }

    // working: advance through any elapsed minute boundaries
    const elapsedTotal = Math.max(0, now - this.startedAtMs);
    const expectedCompleted = Math.min(this.totalMinutes, Math.floor(elapsedTotal / MINUTE_MS));

    while (this.sets.length < expectedCompleted) {
      this.sets.push({ reps: this.currentMinuteReps, workMs: MINUTE_MS });
      this.currentMinuteReps = this.targetRepsPerMin;
      if (this.sets.length < this.totalMinutes) {
        this.pendingMinuteCue = this.sets.length + 1;
      }
    }

    if (this.sets.length >= this.totalMinutes) {
      this.endedAtMs = this.startedAtMs + this.totalMinutes * MINUTE_MS;
      this.phase = "done";
      this.justEnteredPhase = "done";
      const cue = this.pendingMinuteCue;
      this.pendingMinuteCue = null;
      return {
        phase: "done",
        minuteNumber: this.sets.length,
        totalMinutes: this.totalMinutes,
        targetRepsPerMin: this.targetRepsPerMin,
        currentMinuteReps: 0,
        setsCompleted: this.sets.length,
        totalReps: sumReps(this.sets),
        minuteElapsedMs: 0,
        minuteRemainingMs: 0,
        totalElapsedMs: Math.max(0, this.endedAtMs - this.startedAtMs),
        sets: this.sets,
        enteredPhase: "done",
        minuteCueAt: cue,
      };
    }

    const minuteStart = this.sets.length * MINUTE_MS;
    const minuteElapsed = elapsedTotal - minuteStart;
    const cue = this.pendingMinuteCue;
    this.pendingMinuteCue = null;

    return {
      phase: "working",
      minuteNumber: this.sets.length + 1,
      totalMinutes: this.totalMinutes,
      targetRepsPerMin: this.targetRepsPerMin,
      currentMinuteReps: this.currentMinuteReps,
      setsCompleted: this.sets.length,
      totalReps: sumReps(this.sets),
      minuteElapsedMs: minuteElapsed,
      minuteRemainingMs: MINUTE_MS - minuteElapsed,
      totalElapsedMs: elapsedTotal,
      sets: this.sets,
      enteredPhase: entered,
      minuteCueAt: cue,
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sumReps(sets: ReadonlyArray<EmomSetRecord>): number {
  return sets.reduce((s, x) => s + x.reps, 0);
}
