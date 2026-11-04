// Builds every raster logo from design/icon.svg (the Eq tile: navy sky, amber Eq, arrow, tray).
//   node design/build-icons.mjs        then:  node desktop/scripts/make-icon.mjs && node android/scripts/make-icons.mjs
// It cuts the tile's border and stars away and zooms in so the Eq and arrow fill the icon: two full-bleed variants,
//   icon-glyph.png     (glyph fills ~90%): web, desktop, header, favicon
//   icon-adaptive.png  (glyph fills ~72%): Android adaptive icon safe zone, maskable web icon
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'design', 'icon.svg'), 'utf8');

// Keep the fonts, gradients and the glyph; replace the tile frame with one full-bleed gradient rectangle.
const head = src.slice(0, src.indexOf('</defs>'));
const glyph = src.slice(src.indexOf('<g filter='), src.lastIndexOf('</svg>'));
const GROUND = '<linearGradient id="full" gradientUnits="userSpaceOnUse" x1="0" y1="14" x2="0" y2="386"><stop offset="0" stop-color="#0B132B"/><stop offset=".55" stop-color="#1C2541"/><stop offset="1" stop-color="#3A506B"/></linearGradient>';
function variant(side, cx = 205, cy = 213) {
  const vb = `${cx - side / 2} ${cy - side / 2} ${side} ${side}`;
  const open = head.replace(/<svg[^>]*>/, `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">`);
  return `${open}${GROUND}</defs><rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#full)"/>${glyph}</svg>`;
}
function markOnly() {
  const open = head.replace(/<svg[^>]*>/, '<svg viewBox="82 74 246 270" xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">');
  return `${open}</defs>${glyph}</svg>`;
}
const VARIANTS = { 'icon-glyph': variant(278), 'icon-adaptive': variant(330) };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  for (const [name, svg] of Object.entries(VARIANTS)) {
    writeFileSync(join(root, 'design', `${name}.svg`), svg);
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    writeFileSync(join(root, 'design', `${name}.png`), await page.screenshot({ type: 'png' }));
  }
  // The transparent mark used as a watermark behind the site and the app.
  const mark = markOnly();
  writeFileSync(join(root, 'design', 'icon-mark.svg'), mark);
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${mark}</body>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const markPng = await page.screenshot({ type: 'png', omitBackground: true });
  writeFileSync(join(root, 'design', 'icon-mark.png'), markPng);
  writeFileSync(join(root, 'site', 'mark.png'), markPng);
  writeFileSync(join(root, 'ui', 'public', 'mark.png'), markPng);
  // Small sizes, rendered from the 1024 master by the browser's own scaler.
  const sizes = [
    ['icon-glyph', 'ui/public/logo.png', 256], ['icon-glyph', 'site/logo.png', 192], ['icon-glyph', 'site/icon-192.png', 192],
    ['icon-glyph', 'site/icon-512.png', 512], ['icon-glyph', 'site/apple-touch-icon.png', 180], ['icon-adaptive', 'site/icon-maskable-512.png', 512],
  ];
  for (const [name, out, size] of sizes) {
    const url = 'data:image/png;base64,' + readFileSync(join(root, 'design', `${name}.png`)).toString('base64');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0"><img id="i" src="${url}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.waitForFunction(() => document.getElementById('i').complete);
    mkdirSync(dirname(join(root, out)), { recursive: true });
    writeFileSync(join(root, out), await page.locator('#i').screenshot({ type: 'png' }));
  }
} finally {
  await browser.close();
}
console.log('icons built from design/icon.svg');
