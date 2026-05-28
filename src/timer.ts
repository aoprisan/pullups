export type Phase = "idle" | "working" | "logging" | "resting" | "done";

export interface SetRecord {
  reps: number;
  workMs: number;
  restMsAfter: number;
}

export interface ViewState {
  phase: Phase;
  setNumber: number;
  setsCompleted: number;
  totalReps: number;
  workElapsedMs: number;
  restElapsedMs: number;
  totalElapsedMs: number;
  pendingSetWorkMs: number;
  sets: ReadonlyArray<SetRecord>;
  enteredPhase: Phase | null;
}

export class PullupTimer {
  private phase: Phase = "idle";
  private startedAtMs = 0;
  private workStartMs = 0;
  private restStartMs = 0;
  private endedAtMs = 0;
  private pendingWorkMs = 0;
  private sets: SetRecord[] = [];
  private justEnteredPhase: Phase | null = null;

  get currentPhase(): Phase {
    return this.phase;
  }

  get completedSets(): number {
    return this.sets.length;
  }

  get lastReps(): number | null {
    return this.sets.length === 0 ? null : this.sets[this.sets.length - 1].reps;
  }

  start(now: number): void {
    if (this.phase !== "idle" && this.phase !== "done") return;
    this.phase = "working";
    this.startedAtMs = now;
    this.workStartMs = now;
    this.restStartMs = 0;
    this.endedAtMs = 0;
    this.pendingWorkMs = 0;
    this.sets = [];
    this.justEnteredPhase = "working";
  }

  setDone(now: number): void {
    if (this.phase !== "working") return;
    this.pendingWorkMs = Math.max(0, now - this.workStartMs);
    this.phase = "logging";
    this.justEnteredPhase = "logging";
  }

  logReps(reps: number, now: number): void {
    if (this.phase !== "logging") return;
    const safeReps = Math.max(0, Math.floor(reps));
    this.sets.push({ reps: safeReps, workMs: this.pendingWorkMs, restMsAfter: 0 });
    this.pendingWorkMs = 0;
    this.restStartMs = now;
    this.phase = "resting";
    this.justEnteredPhase = "resting";
  }

  cancelLog(now: number): void {
    if (this.phase !== "logging") return;
    this.workStartMs = now - this.pendingWorkMs;
    this.pendingWorkMs = 0;
    this.phase = "working";
    this.justEnteredPhase = null;
  }

  nextSet(now: number): void {
    if (this.phase !== "resting") return;
    const lastIdx = this.sets.length - 1;
    if (lastIdx >= 0) {
      this.sets[lastIdx] = {
        ...this.sets[lastIdx],
        restMsAfter: Math.max(0, now - this.restStartMs),
      };
    }
    this.workStartMs = now;
    this.phase = "working";
    this.justEnteredPhase = "working";
  }

  endSession(now: number): void {
    if (this.phase === "idle" || this.phase === "done") return;
    if (this.phase === "resting") {
      const lastIdx = this.sets.length - 1;
      if (lastIdx >= 0) {
        this.sets[lastIdx] = {
          ...this.sets[lastIdx],
          restMsAfter: Math.max(0, now - this.restStartMs),
        };
      }
    }
    this.pendingWorkMs = 0;
    this.endedAtMs = now;
    this.phase = "done";
    this.justEnteredPhase = "done";
  }

  reset(): void {
    this.phase = "idle";
    this.startedAtMs = 0;
    this.workStartMs = 0;
    this.restStartMs = 0;
    this.endedAtMs = 0;
    this.pendingWorkMs = 0;
    this.sets = [];
    this.justEnteredPhase = null;
  }

  tick(now: number): ViewState {
    const setsCompleted = this.sets.length;
    const totalReps = this.sets.reduce((sum, s) => sum + s.reps, 0);
    const entered = this.justEnteredPhase;
    this.justEnteredPhase = null;

    if (this.phase === "idle") {
      return base({
        phase: "idle",
        setNumber: 1,
        setsCompleted: 0,
        totalReps: 0,
        workElapsedMs: 0,
        restElapsedMs: 0,
        totalElapsedMs: 0,
        pendingSetWorkMs: 0,
        sets: this.sets,
        enteredPhase: entered,
      });
    }

    if (this.phase === "done") {
      return base({
        phase: "done",
        setNumber: Math.max(1, setsCompleted),
        setsCompleted,
        totalReps,
        workElapsedMs: 0,
        restElapsedMs: 0,
        totalElapsedMs: Math.max(0, this.endedAtMs - this.startedAtMs),
        pendingSetWorkMs: 0,
        sets: this.sets,
        enteredPhase: entered,
      });
    }

    if (this.phase === "working") {
      return base({
        phase: "working",
        setNumber: setsCompleted + 1,
        setsCompleted,
        totalReps,
        workElapsedMs: Math.max(0, now - this.workStartMs),
        restElapsedMs: 0,
        totalElapsedMs: Math.max(0, now - this.startedAtMs),
        pendingSetWorkMs: 0,
        sets: this.sets,
        enteredPhase: entered,
      });
    }

    if (this.phase === "logging") {
      return base({
        phase: "logging",
        setNumber: setsCompleted + 1,
        setsCompleted,
        totalReps,
        workElapsedMs: this.pendingWorkMs,
        restElapsedMs: 0,
        totalElapsedMs: Math.max(0, now - this.startedAtMs),
        pendingSetWorkMs: this.pendingWorkMs,
        sets: this.sets,
        enteredPhase: entered,
      });
    }

    return base({
      phase: "resting",
      setNumber: setsCompleted,
      setsCompleted,
      totalReps,
      workElapsedMs: 0,
      restElapsedMs: Math.max(0, now - this.restStartMs),
      totalElapsedMs: Math.max(0, now - this.startedAtMs),
      pendingSetWorkMs: 0,
      sets: this.sets,
      enteredPhase: entered,
    });
  }
}

function base(v: ViewState): ViewState {
  return v;
}
