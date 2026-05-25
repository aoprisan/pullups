# Pullups

Self-contained SPA for an EMOM-20 pullup workout: 20 reps, one cued every minute on the minute, with a 5-second countdown before rep 1.

Installable as a PWA: works offline (app shell, fonts, and assets are cached) and can be added to the home screen on mobile or installed from the browser on desktop.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build       # tsc --noEmit && vite build → dist/
npm run preview     # serve dist/ locally
```

## Deploy to GitHub Pages

1. Create a repo named `pullups` on GitHub and push this directory to it.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds and publishes `dist/` to Pages.
4. Live site: `https://<your-user>.github.io/pullups/`.

If your repo name differs from `pullups`, update `base` in `vite.config.ts` (the PWA manifest `scope`/`start_url` follow it).

## Icons

App icons in `public/` are generated from `scripts/generate-icons.mjs`. To regenerate (e.g. after a palette change):

```bash
npm install --no-save sharp
node scripts/generate-icons.mjs
```
