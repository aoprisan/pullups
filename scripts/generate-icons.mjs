// One-off icon generator for the PWA. Run with: node scripts/generate-icons.mjs
// Requires `sharp` to be installed (it is not a runtime dependency).
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public");

const PAPER = "#efe7d4";
const BRICK = "#6e1f1a";

// Tally-of-five mark (four uprights + a diagonal slash) drawn in a 100x100 box.
function tally(strokeWidth) {
  const bars = [22, 38, 54, 70]
    .map(
      (x) =>
        `<line x1="${x}" y1="20" x2="${x}" y2="80" stroke="${BRICK}" stroke-width="${strokeWidth}" stroke-linecap="round" />`,
    )
    .join("");
  const slash = `<line x1="12" y1="78" x2="80" y2="22" stroke="${BRICK}" stroke-width="${strokeWidth}" stroke-linecap="round" />`;
  return bars + slash;
}

// `scale` is the fraction of the canvas the mark occupies (used to honor the
// maskable safe zone). The mark is centered.
function svg(size, scale, strokeWidth) {
  const markSize = size * scale;
  const offset = (size - markSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${PAPER}" />
  <g transform="translate(${offset} ${offset}) scale(${markSize / 100})">
    ${tally(strokeWidth)}
  </g>
</svg>`;
}

async function render(name, size, scale, strokeWidth) {
  const buffer = Buffer.from(svg(size, scale, strokeWidth));
  await sharp(buffer).png().toFile(join(OUT, name));
  console.log("wrote", name);
}

await render("pwa-192x192.png", 192, 0.74, 9);
await render("pwa-512x512.png", 512, 0.74, 9);
// Maskable: keep the mark inside the central safe zone so launchers can crop.
await render("pwa-maskable-512x512.png", 512, 0.56, 10);
await render("apple-touch-icon.png", 180, 0.72, 9.5);

// SVG favicon (crisp at any size; replaces the inline data-URI one).
await sharp(Buffer.from(svg(64, 0.74, 9)))
  .png()
  .toFile(join(OUT, "favicon-64.png"));
console.log("done");
