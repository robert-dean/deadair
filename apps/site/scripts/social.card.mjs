/**
 * Draws `static/img/social.card.png`, the 1200x630 image a link to this site unfurls with.
 *
 * `node scripts/social.card.mjs [path to a browser]`. The logo, the colours and the screenshot are the site's own, so
 * run it again when the desk's screenshot is retaken. Google Fonts are not fetched: the faces come
 * from the same `@fontsource` packages the site loads. Cover art is other people's, so `.cover` blurs
 * the record on air in that screenshot, by position: move it if a retake moves the cover.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));

const dataUrl = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;
const face = (pkg, weight) => dataUrl(require.resolve(`${pkg}/files/${pkg.split('/')[1]}-latin-${weight}-normal.woff2`), 'font/woff2');

const html = `<!doctype html><style>
    @font-face { font-family: Plex; font-weight: 500; src: url(${face('@fontsource/ibm-plex-sans', 500)}); }
    @font-face { font-family: Chakra; font-weight: 600; src: url(${face('@fontsource/chakra-petch', 600)}); }
    * { margin: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; position: relative; background: #0c0e0d; color: #e8edea; font-family: Plex; }
    .brand { position: absolute; left: 64px; top: 56px; display: flex; align-items: center; gap: 16px; font: 600 38px Chakra; }
    .brand img { width: 52px; height: 52px; }
    h1 { position: absolute; left: 64px; top: 142px; width: 1000px; font-size: 68px; font-weight: 500; line-height: 1.08; letter-spacing: -0.025em; }
    .desk { position: absolute; left: 64px; top: 324px; width: 1072px; border: 1px solid #313836; border-radius: 12px; }
    .cover { position: absolute; left: 244px; top: 391px; width: 69px; height: 70px; backdrop-filter: blur(14px); }
    .fade { position: absolute; inset: 500px 0 0; background: linear-gradient(transparent, #0c0e0d); }
</style>
<div class="brand"><img src="${dataUrl(join(root, '../web/public/logo-mark.png'), 'image/png')}">deadair</div>
<h1>An AI radio station<br>you run yourself.</h1>
<img class="desk" src="${dataUrl(join(root, 'static/img/console/desk.webp'), 'image/webp')}">
<div class="cover"></div>
<div class="fade"></div>`;

const browser = await chromium.launch({ executablePath: process.argv[2] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, 'static/img/social.card.png') });
await browser.close();
