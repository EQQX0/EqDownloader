// Builds desktop/build/icon.ico from design/icon.png.
// Rasterises with the Chromium that @playwright/test already installs for the e2e suite (no new dependency),
// then packs the PNGs into one ICO (PNG-compressed entries, supported by Windows Vista and later).
//   node desktop/scripts/make-icon.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const pngPath = join(here, '..', '..', 'design', 'icon-glyph.png');
const outPath = join(here, '..', 'build', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const dataUrl = 'data:image/png;base64,' + readFileSync(pngPath).toString('base64');
const browser = await chromium.launch();
const pngs = [];
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent"><img id="logo" src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    await page.waitForFunction(() => document.getElementById('logo').complete);
    pngs.push(await page.locator('#logo').screenshot({ omitBackground: true, type: 'png' }));
  }
} finally {
  await browser.close();
}

// ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes) per image, then the PNG data.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
const entries = [];
let offset = 6 + 16 * pngs.length;
pngs.forEach((png, i) => {
  const size = SIZES[i];
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
  e.writeUInt8(size >= 256 ? 0 : size, 1); // height
  e.writeUInt8(0, 2); // palette colours
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(e);
});
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.concat([header, ...entries, ...pngs]));
console.log(`wrote ${outPath} (${SIZES.join(', ')} px)`);
