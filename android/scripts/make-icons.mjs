// Builds the Android launcher icons from design/icon.png (the logo on a transparent square).
// Rasterises with the Chromium that @playwright/test already installs for the e2e suite (sharp is not a
// dependency of this repo, same choice as desktop/scripts/make-icon.mjs). Output, per density:
//   mipmap-<d>/ic_launcher_foreground.png   adaptive foreground (108dp canvas, the transparent Eq mark box at 80%; the glyph itself stays inside the 66dp safe zone)
//   mipmap-<d>/ic_launcher.png              legacy square icon (48dp): the glyph with rounded corners
//   mipmap-<d>/ic_launcher_round.png        legacy round icon (48dp): the circle filling the canvas
// The adaptive background is the colour resource ic_launcher_background (#0B132B, the logo's navy) and
// mipmap-anydpi-v26/*.xml wire them together; those files are checked in.
//   node android/scripts/make-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const glyphPath = join(here, '..', '..', 'design', 'icon-glyph.png');
const markPath = join(here, '..', '..', 'design', 'icon-fg.png');
const GROUND = 'linear-gradient(180deg, #0F1A38 0%, #1B2848 55%, #2E4565 100%)'; // keep in sync with drawable/ic_launcher_background.xml
const resDir = join(here, '..', 'app', 'src', 'main', 'res');

// Scale factor per density bucket (mdpi = 1).
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const urlOf = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');
const glyphUrl = urlOf(glyphPath);
const markUrl = urlOf(markPath);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  // `inner` is the logo's share of the canvas; `ground` is the canvas colour (transparent when null).
  async function render(size, { inner = 1, ground = null, src = glyphUrl, radius = '0' } = {}) {
    const logo = Math.round(size * inner);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent"><div id="c" style="width:${size}px;height:${size}px;display:grid;place-items:center;background:${ground ?? 'transparent'};border-radius:${radius};overflow:hidden"><img id="logo" src="${src}" width="${logo}" height="${logo}" style="display:block"></div></body></html>`,
    );
    await page.waitForFunction(() => document.getElementById('logo').complete);
    return page.locator('#c').screenshot({ omitBackground: true, type: 'png' });
  }

  for (const [name, scale] of Object.entries(DENSITIES)) {
    const dir = join(resDir, `mipmap-${name}`);
    mkdirSync(dir, { recursive: true });
    const legacy = Math.round(48 * scale);
    const adaptive = Math.round(108 * scale);
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), await render(adaptive, { inner: 1, src: markUrl }));
    writeFileSync(join(dir, 'ic_launcher.png'), await render(legacy, { inner: 1, src: markUrl, ground: GROUND, radius: '18%' }));
    writeFileSync(join(dir, 'ic_launcher_round.png'), await render(legacy, { inner: 0.86, src: markUrl, ground: GROUND, radius: '50%' }));
    console.log(`mipmap-${name}: foreground ${adaptive}px, legacy ${legacy}px`);
  }
} finally {
  await browser.close();
}
