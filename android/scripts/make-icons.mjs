// Builds the Android launcher icons from design/icon.svg.
// Rasterises with the Chromium that @playwright/test already installs for the e2e suite (sharp is not a
// dependency of this repo, same choice as desktop/scripts/make-icon.mjs). Output, per density:
//   mipmap-<d>/ic_launcher_foreground.png   adaptive foreground (108dp canvas, gold bars on transparent)
//   mipmap-<d>/ic_launcher.png              legacy square icon (48dp)
//   mipmap-<d>/ic_launcher_round.png        legacy round icon (48dp)
// The adaptive background is the colour resource ic_launcher_background (#133621) and
// mipmap-anydpi-v26/*.xml wire them together; those files are checked in.
//   node android/scripts/make-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = join(here, '..', '..', 'design', 'icon.svg');
const resDir = join(here, '..', 'app', 'src', 'main', 'res');

// Scale factor per density bucket (mdpi = 1).
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const svg = readFileSync(svgPath, 'utf8');
// The full-bleed ground rect is the only element that spans the whole 256 box; dropping it leaves the bars.
const barsOnly = svg.replace(/<rect width="256" height="256"[^>]*\/>/, '');
if (barsOnly === svg) throw new Error('icon.svg no longer has its ground rect; update make-icons.mjs');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  async function render(markup, size, { round = false, transparent = false } = {}) {
    const sized = markup.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    const clip = round ? 'border-radius:50%;overflow:hidden;' : '';
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;${clip}">${sized}</div></body></html>`,
    );
    return page.locator('div').first().screenshot({ omitBackground: transparent, type: 'png' });
  }

  for (const [name, scale] of Object.entries(DENSITIES)) {
    const dir = join(resDir, `mipmap-${name}`);
    mkdirSync(dir, { recursive: true });
    const legacy = Math.round(48 * scale);
    const adaptive = Math.round(108 * scale);
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), await render(barsOnly, adaptive, { transparent: true }));
    writeFileSync(join(dir, 'ic_launcher.png'), await render(svg, legacy));
    writeFileSync(join(dir, 'ic_launcher_round.png'), await render(svg, legacy, { round: true, transparent: true }));
    console.log(`mipmap-${name}: foreground ${adaptive}px, legacy ${legacy}px`);
  }
} finally {
  await browser.close();
}
