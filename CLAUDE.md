# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page PWA for an EMOM ("every minute on the minute") pullup workout: do 10 or 20 reps, one per minute. You tap **PULLUP DONE** to log each rep, then a 60-second rest countdown runs and the next rep is cued with a beep. No backend, no framework — vanilla TypeScript + Vite, deployed as a static site to GitHub Pages.

## Commands

```bash
npm run dev        # Vite dev server (PWA service worker is enabled in dev — see vite.config devOptions)
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # serve the built dist/ locally
npm run typecheck  # tsc --noEmit (run this to check types without building)
```

There is **no test runner and no linter** configured. `npm run build` runs `tsc --noEmit` first, so a type error fails the build (and the GitHub Actions deploy). TypeScript is `strict` with `noUnusedLocals`/`noUnusedParameters`, so unused symbols are errors, not warnings.

Regenerate app icons in `public/` after a palette change:

```bash
npm install --no-save sharp && node scripts/generate-icons.mjs
```

## Architecture

Three source modules with a strict separation:

- **`src/timer.ts`** — `PullupTimer`, a pure state machine. No DOM, no time access of its own: every method takes `now` (a `performance.now()` timestamp) as an argument. This makes it deterministic and the natural place to add logic. Phases: `idle → ready → resting → (paused) → ready → … → done`. `tick(now)` returns an immutable `ViewState` snapshot.
- **`src/main.ts`** — the view/controller. Owns all DOM, builds the UI as one big `innerHTML` template, wires button handlers, and runs a `requestAnimationFrame` loop that calls `timer.tick(now)` then `render(view)` every frame.
- **`src/audio.ts`** — Web Audio beeps. A single shared `AudioContext` that must be resumed on a user gesture; `unlockAudio()` is called from the first button tap.

### The one-shot event pattern (important)

`render()` is called every frame off a `ViewState`, so it must be idempotent — never trigger a side effect (beep, animation) directly from `render`. Instead, `tick()` computes edge-triggered fields that are **non-null only on the single frame the event occurs**: `newRepReadyIndex` (rest finished, cue the next rep) and `newRestCountdownTickIndex` (a countdown second elapsed). The rAF loop in `main.ts` reads these and fires `beepRepCue()` / `beepCountdown()`. If you add a new "fire once" behavior, follow this pattern rather than diffing state in the render layer.

### Pause/resume

`pause`/`resume` shift `startedAtMs` and `restStartMs` by the paused duration (`drift`) so the elapsed clock and rest countdown stay correct across pauses, without storing wall-clock time.

### State that persists / config

- Rep count (10 or 20) is persisted to `localStorage` under `pullups.reps`; it can only be changed while `idle` or `done` (`canChangeReps()`). Changing reps rebuilds the `PullupTimer`.
- `INTERVAL_MS = 60_000` in `main.ts` is the rest/EMOM interval.
- `__BUILD_TIME__` is injected at build time via Vite's `define` (see `vite.config.ts`) and typed in `src/vite-env.d.ts`; the UI shows it as the build stamp.

## Deploy & the `base` path

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages. The site is served from a sub-path, so **`const base = "/pullups/"` in `vite.config.ts` must match the repo name** — the PWA manifest `scope`/`start_url` and asset URLs all derive from it. If the repo is renamed, update that one constant.

## PWA update flow

Service worker registration is done manually via `registerSW` in `main.ts` (not the plugin's auto-injected registration) specifically so updates never reload the page mid-workout. In `autoUpdate` mode the new worker activates on its own; `onNeedReload` only reloads immediately if the user pressed **Update app** (`userRequestedUpdate`), otherwise it surfaces "Update ready · tap" and waits. When touching update behavior, preserve this "never interrupt a workout" intent.

## Styling

All styles live in `src/styles.css` (~600 lines, hand-written, no preprocessor). Design tokens are CSS custom properties in `:root` (the "Locker Room Cardboard" palette: `--paper`, `--brick`, `--signal`, etc.). The progress dial and primary button are styled per phase via classes that mirror the `Phase` type (`.dial-fill.resting`, `.primary.ready`, …), which `render()` toggles. The dial's tick marks and numerals are generated as SVG in `buildDialDecorations()` in `main.ts`.
