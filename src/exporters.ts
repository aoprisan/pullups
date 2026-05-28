import type { SetRecord } from "./timer";
import type { EmomSetRecord } from "./emomTimer";

export type BandId = "green" | "yellow" | "orange" | "red" | "none";
export type WeightUnit = "kg" | "lb";
export type SessionType = "open" | "emom";

interface SessionBase {
  date: string;
  band: BandId;
  bandLabel: string;
  bandColor: string;
  elapsedMs: number;
  totalReps: number;
  bodyWeightKg: number | null;
  weightUnit: WeightUnit;
}

export interface OpenSessionData extends SessionBase {
  type: "open";
  sets: ReadonlyArray<SetRecord>;
}

export interface EmomSessionData extends SessionBase {
  type: "emom";
  targetRepsPerMin: number;
  targetMinutes: number;
  sets: ReadonlyArray<EmomSetRecord>;
}

export type SessionData = OpenSessionData | EmomSessionData;

const OPEN_PROMPT =
  "You are an expert calisthenics coach. Analyse my pull-up workout log below " +
  "and give me: pacing and set-to-set consistency, fatigue patterns across the " +
  "sets, what the rest intervals say about my conditioning, and 2-3 concrete " +
  "recommendations for my next workout. The session follows.";

const EMOM_PROMPT =
  "You are an expert calisthenics coach. Analyse my pull-up EMOM (every-minute-on-" +
  "the-minute) workout below and give me: how close I held to the target reps each " +
  "minute, fatigue patterns over the duration, whether the prescribed reps/min was " +
  "appropriate, and 2-3 concrete recommendations for my next EMOM. The session follows.";

const CLAUDE_NEW_CHAT_URL = "https://claude.ai/new";

const PALETTE = {
  paper: "#efe7d4",
  paperDeep: "#e4d9bc",
  paperAsh: "#d9cdab",
  ink: "#15110d",
  inkSoft: "rgba(21, 17, 13, 0.62)",
  inkFaint: "rgba(21, 17, 13, 0.22)",
  brick: "#6e1f1a",
  signal: "#d6422b",
  mustard: "#bd8a1c",
} as const;

interface ShareCapableNavigator {
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
}

function shareNav(): ShareCapableNavigator {
  return navigator as unknown as ShareCapableNavigator;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBodyWeight(kg: number | null, unit: WeightUnit): string | null {
  if (kg === null) return null;
  if (unit === "lb") {
    const lb = kg * 2.2046226218;
    return `${Math.round(lb * 10) / 10} lb`;
  }
  return `${Math.round(kg * 10) / 10} kg`;
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function sessionSlug(s: SessionData): string {
  const d = new Date(s.date);
  const stamp = Number.isNaN(d.getTime())
    ? "session"
    : d.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `pullups-${s.type}-${stamp}`;
}

function sessionToMarkdown(s: SessionData): string {
  const bw = formatBodyWeight(s.bodyWeightKg, s.weightUnit);
  const lines: string[] = [];

  if (s.type === "emom") {
    lines.push(`# Pull-up EMOM — ${formatLongDate(s.date)}`);
    const metaParts = [
      `Target: ${s.targetRepsPerMin} reps/min × ${s.targetMinutes} min`,
      `Resistance band: ${s.bandLabel}`,
    ];
    if (bw) metaParts.push(`Body weight: ${bw}`);
    lines.push(metaParts.join(" · "));
    const completed = s.sets.length;
    const target = s.targetRepsPerMin * s.targetMinutes;
    lines.push(
      `Completed ${completed}/${s.targetMinutes} minutes · ${s.totalReps}/${target} reps · ${formatClock(s.elapsedMs)} elapsed`,
    );

    if (s.sets.length > 0) {
      lines.push("");
      lines.push("| Min | Reps | Hit target? |");
      lines.push("|----:|-----:|:------------|");
      s.sets.forEach((set, i) => {
        const hit = set.reps >= s.targetRepsPerMin ? "yes" : `−${s.targetRepsPerMin - set.reps}`;
        lines.push(`| ${i + 1} | ${set.reps} | ${hit} |`);
      });
    }
  } else {
    const setCount = s.sets.length;
    const summary = `${setCount} ${setCount === 1 ? "set" : "sets"} · ${s.totalReps} reps · ${formatClock(s.elapsedMs)} total`;
    const meta = bw
      ? `Resistance band: ${s.bandLabel} · Body weight: ${bw}`
      : `Resistance band: ${s.bandLabel}`;

    lines.push(`# Pull-up workout — ${formatLongDate(s.date)}`);
    lines.push(meta);
    lines.push(summary);

    if (setCount > 0) {
      lines.push("");
      lines.push("| Set | Reps | Work | Rest after |");
      lines.push("|----:|-----:|-----:|-----------:|");
      s.sets.forEach((set, i) => {
        const rest = i < setCount - 1 ? formatClock(set.restMsAfter) : "—";
        lines.push(`| ${i + 1} | ${set.reps} | ${formatClock(set.workMs)} | ${rest} |`);
      });
    }
  }

  return lines.join("\n");
}

export function buildSessionPrompt(s: SessionData): string {
  const prompt = s.type === "emom" ? EMOM_PROMPT : OPEN_PROMPT;
  return [prompt, "", sessionToMarkdown(s)].join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image."))),
      type,
    );
  });
}

export type AnalyzeResult = "shared" | "copied-opened" | "copied" | "downloaded";

export async function analyzeSessionInClaude(s: SessionData): Promise<AnalyzeResult> {
  const markdown = buildSessionPrompt(s);
  const nav = shareNav();
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title: "Pull-up workout", text: markdown });
      void copyText(markdown);
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
    }
  }
  const copied = await copyText(markdown);
  if (copied) {
    const opened = window.open(CLAUDE_NEW_CHAT_URL, "_blank", "noopener");
    return opened ? "copied-opened" : "copied";
  }
  downloadBlob(new Blob([markdown], { type: "text/markdown" }), `${sessionSlug(s)}.md`);
  return "downloaded";
}

export type CopyResult = "copied" | "downloaded";

export async function copySessionPrompt(s: SessionData): Promise<CopyResult> {
  const markdown = buildSessionPrompt(s);
  if (await copyText(markdown)) return "copied";
  downloadBlob(new Blob([markdown], { type: "text/markdown" }), `${sessionSlug(s)}.md`);
  return "downloaded";
}

export type ShareResult = "shared" | "downloaded";

export async function shareSessionPng(s: SessionData): Promise<ShareResult> {
  const canvas = await renderSessionToCanvas(s);
  const blob = await canvasToBlob(canvas, "image/png");
  const filename = `${sessionSlug(s)}.png`;
  const file = new File([blob], filename, { type: "image/png" });
  const nav = shareNav();
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Pull-up workout", text: "Pull-up workout" });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await Promise.all([
      document.fonts.load(`72px "Bungee"`),
      document.fonts.load(`160px "Bowlby One"`),
      document.fonts.load(`700 14px "IBM Plex Mono"`),
      document.fonts.load(`500 14px "IBM Plex Mono"`),
    ]);
  } catch {
    // fonts will fall back to system stack — render anyway
  }
}

async function renderSessionToCanvas(s: SessionData): Promise<HTMLCanvasElement> {
  await ensureFonts();

  const W = 720;
  const PAD = 48;
  const SCALE = 2;

  const setCount = s.sets.length;
  const bwLabel = formatBodyWeight(s.bodyWeightKg, s.weightUnit);
  const isEmom = s.type === "emom";
  const headerH = 152;
  const bigH = 220;
  const statsH = 130;
  const targetH = isEmom ? 56 : 0;
  const bwH = bwLabel ? 44 : 0;
  const setsHeaderH = setCount > 0 ? 60 : 0;
  const setsRowH = 48;
  const setsH = setCount > 0 ? setsHeaderH + setCount * setsRowH + 16 : 0;
  const footerH = 64;
  const totalH = PAD + headerH + bigH + statsH + targetH + bwH + setsH + footerH + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = totalH * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable.");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, W, totalH);
  drawGrain(ctx, W, totalH);

  let y = PAD;

  // ── Masthead ───────────────────────────────────────────────
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = PALETTE.ink;
  ctx.font = `78px "Bungee", "Impact", sans-serif`;
  ctx.textAlign = "left";
  const titleY = y + 78;
  ctx.fillText("PULL", PAD, titleY);
  const pullW = ctx.measureText("PULL").width;
  ctx.fillStyle = PALETTE.signal;
  ctx.fillText("·", PAD + pullW, titleY);
  const dotW = ctx.measureText("·").width;
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText("UPS", PAD + pullW + dotW, titleY);

  const d = new Date(s.date);
  const datePart = Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "2-digit",
        month: "short",
      })
        .format(d)
        .toUpperCase();
  const timePart = Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);

  ctx.textAlign = "right";
  ctx.font = `700 13px "IBM Plex Mono", monospace`;
  ctx.fillStyle = PALETTE.brick;
  ctx.fillText(datePart, W - PAD, y + 30);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = `700 22px "IBM Plex Mono", monospace`;
  ctx.fillText(timePart, W - PAD, y + 64);

  // Hatching divider
  y += headerH - 24;
  drawHatching(ctx, PAD, y, W - 2 * PAD, 14);

  y += 30;

  // ── Big number ─────────────────────────────────────────────
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.brick;
  ctx.font = `170px "Bowlby One", "Impact", serif`;
  ctx.fillText(String(s.totalReps), W / 2, y + 150);
  ctx.font = `700 13px "IBM Plex Mono", monospace`;
  ctx.fillStyle = PALETTE.inkSoft;
  ctx.fillText("TOTAL PULL-UPS", W / 2, y + 190);

  y += bigH - 30;

  // ── Stats row ──────────────────────────────────────────────
  const cols = 3;
  const colW = (W - 2 * PAD) / cols;
  const setsLabel = isEmom ? "MINUTES" : "SETS";
  const setsValue = isEmom
    ? `${setCount}/${(s as EmomSessionData).targetMinutes}`
    : String(setCount);
  drawStatBox(ctx, PAD + colW * 0, y, colW, statsH - 30, setsLabel, setsValue);
  drawStatBox(ctx, PAD + colW * 1, y, colW, statsH - 30, "TIME", formatClock(s.elapsedMs));
  drawBandBox(
    ctx,
    PAD + colW * 2,
    y,
    colW,
    statsH - 30,
    "BAND",
    s.bandLabel.toUpperCase(),
    s.bandColor,
    s.band === "none",
  );
  y += statsH;

  if (isEmom) {
    const emom = s as EmomSessionData;
    ctx.textAlign = "center";
    ctx.font = `700 12px "IBM Plex Mono", monospace`;
    ctx.fillStyle = PALETTE.brick;
    ctx.fillText(
      `TARGET · ${emom.targetRepsPerMin} REPS/MIN × ${emom.targetMinutes} MIN`,
      W / 2,
      y + 24,
    );
    y += targetH;
  }

  if (bwLabel) {
    ctx.textAlign = "center";
    ctx.font = `700 12px "IBM Plex Mono", monospace`;
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.fillText(`BODY WEIGHT · ${bwLabel.toUpperCase()}`, W / 2, y + 20);
    y += bwH;
  }

  // ── Set table ──────────────────────────────────────────────
  if (setCount > 0) {
    const tx = {
      n: PAD + 6,
      reps: PAD + 100,
      mid: W - PAD - 180,
      right: W - PAD - 6,
    };

    ctx.font = `700 11px "IBM Plex Mono", monospace`;
    ctx.fillStyle = PALETTE.brick;
    ctx.textAlign = "left";
    if (isEmom) {
      ctx.fillText("MIN", tx.n, y + 28);
      ctx.fillText("REPS", tx.reps, y + 28);
      ctx.textAlign = "right";
      ctx.fillText("vs TARGET", tx.right, y + 28);
    } else {
      ctx.fillText("SET", tx.n, y + 28);
      ctx.fillText("REPS", tx.reps, y + 28);
      ctx.textAlign = "right";
      ctx.fillText("WORK", tx.mid, y + 28);
      ctx.fillText("REST AFTER", tx.right, y + 28);
    }

    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y + setsHeaderH - 6);
    ctx.lineTo(W - PAD, y + setsHeaderH - 6);
    ctx.stroke();

    y += setsHeaderH;

    if (isEmom) {
      const emom = s as EmomSessionData;
      emom.sets.forEach((set, i) => {
        const rowY = y + i * setsRowH;
        if (i > 0) {
          ctx.strokeStyle = PALETTE.inkFaint;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD, rowY);
          ctx.lineTo(W - PAD, rowY);
          ctx.stroke();
        }
        ctx.textAlign = "left";
        ctx.font = `700 14px "IBM Plex Mono", monospace`;
        ctx.fillStyle = PALETTE.inkSoft;
        ctx.fillText(String(i + 1).padStart(2, "0"), tx.n, rowY + 32);

        ctx.font = `26px "Bowlby One", "Impact", serif`;
        ctx.fillStyle = PALETTE.ink;
        ctx.fillText(String(set.reps), tx.reps, rowY + 34);

        const diff = set.reps - emom.targetRepsPerMin;
        const label = diff >= 0 ? "✓ HIT" : `−${-diff}`;
        ctx.textAlign = "right";
        ctx.font = `700 14px "IBM Plex Mono", monospace`;
        ctx.fillStyle = diff >= 0 ? PALETTE.brick : PALETTE.signal;
        ctx.fillText(label, tx.right, rowY + 32);
      });
    } else {
      const open = s as OpenSessionData;
      open.sets.forEach((set, i) => {
        const rowY = y + i * setsRowH;
        if (i > 0) {
          ctx.strokeStyle = PALETTE.inkFaint;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PAD, rowY);
          ctx.lineTo(W - PAD, rowY);
          ctx.stroke();
        }
        ctx.textAlign = "left";
        ctx.font = `700 14px "IBM Plex Mono", monospace`;
        ctx.fillStyle = PALETTE.inkSoft;
        ctx.fillText(String(i + 1).padStart(2, "0"), tx.n, rowY + 32);

        ctx.font = `26px "Bowlby One", "Impact", serif`;
        ctx.fillStyle = PALETTE.ink;
        ctx.fillText(String(set.reps), tx.reps, rowY + 34);

        ctx.textAlign = "right";
        ctx.font = `500 15px "IBM Plex Mono", monospace`;
        ctx.fillStyle = PALETTE.ink;
        ctx.fillText(formatClock(set.workMs), tx.mid, rowY + 32);

        const rest = i < setCount - 1 ? formatClock(set.restMsAfter) : "—";
        ctx.fillStyle = PALETTE.inkSoft;
        ctx.fillText(rest, tx.right, rowY + 32);
      });
    }

    y += setCount * setsRowH + 16;
  }

  // ── Footer ─────────────────────────────────────────────────
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.font = `700 11px "IBM Plex Mono", monospace`;
  ctx.fillStyle = PALETTE.inkSoft;
  const footerLabel = isEmom ? "PULL·UPS · EMOM WORKOUT LOG" : "PULL·UPS · OPEN-SET WORKOUT LOG";
  ctx.fillText(footerLabel, W / 2, y + 32);

  return canvas;
}

function drawStatBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
): void {
  ctx.save();
  ctx.fillStyle = PALETTE.paperDeep;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  const inset = 6;
  ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  // hard shadow
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(x + inset + 4, y + h - inset, w - inset * 2, 4);
  ctx.fillRect(x + w - inset, y + inset + 4, 4, h - inset * 2);

  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.brick;
  ctx.font = `700 11px "IBM Plex Mono", monospace`;
  ctx.fillText(label, x + w / 2, y + 28);

  ctx.fillStyle = PALETTE.ink;
  ctx.font = `42px "Bowlby One", "Impact", serif`;
  ctx.fillText(value, x + w / 2, y + h - 18);
  ctx.restore();
}

function drawBandBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  color: string,
  isNone: boolean,
): void {
  ctx.save();
  ctx.fillStyle = PALETTE.paperDeep;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  const inset = 6;
  ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(x + inset + 4, y + h - inset, w - inset * 2, 4);
  ctx.fillRect(x + w - inset, y + inset + 4, 4, h - inset * 2);

  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.brick;
  ctx.font = `700 11px "IBM Plex Mono", monospace`;
  ctx.fillText(label, x + w / 2, y + 28);

  // Band dot
  const cx = x + w / 2;
  const cy = y + h / 2 + 6;
  const r = 18;
  if (isNone) {
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy + r * 0.7);
    ctx.lineTo(cx + r * 0.7, cy - r * 0.7);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.fillStyle = PALETTE.ink;
  ctx.font = `700 13px "IBM Plex Mono", monospace`;
  ctx.fillText(value, x + w / 2, y + h - 14);
  ctx.restore();
}

function drawHatching(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(x, y, w, 3);
  ctx.fillRect(x, y + h - 3, w, 3);
  const step = 8;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.5;
  for (let i = -h; i < w; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = PALETTE.ink;
  const count = Math.floor((w * h) / 220);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}
