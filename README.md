# Pullups

Self-contained SPA for an EMOM-20 pullup workout: 20 reps, one cued every minute on the minute, with a 5-second countdown before rep 1.

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

If your repo name differs from `pullups`, update `base` in `vite.config.ts`.
