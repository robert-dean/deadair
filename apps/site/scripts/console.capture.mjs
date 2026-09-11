// Photographs a running station's console for the website.
//
// The screenshots on the front page and in the features docs are of a real station rather than a
// posed one, so they come from a browser signed in to one. This script is that browser. It is run
// by hand, twice: `login` once, in a window you sign in to yourself, and `shoot` as often as the
// console changes enough to be worth re-photographing. What it writes to `static/img/console/` is
// committed; everything else it keeps is under `.capture/`, which is gitignored.
//
//     pnpm --filter @deadair/site capture login
//     pnpm --filter @deadair/site capture shoot
//     pnpm --filter @deadair/site capture shoot --only desk,checkup --blur-art
//     pnpm --filter @deadair/site capture shoot --only desk --theme white
//     pnpm --filter @deadair/site capture shoot --only voice.said --hide 'news flash'
//
// ## The signed-in state goes stale every time it is used
//
// The console's session is an httpOnly refresh cookie, and a refresh token is SINGLE-USE: redeeming
// it hands back a new one, and presenting a spent one again revokes the whole family. So the state
// file is out of date the moment a run's first page redeems it, and a run that exits without
// writing the new cookie back leaves a file whose next use signs the account out everywhere that
// family reached. That is why `shoot` saves the state as soon as the first page is up and again on
// the way out, whether the run succeeded or not. It is also why two runs must never overlap and why
// the file must never be copied. Your own browser holds a different family and is not affected.
//
// If a run dies between those two points (killed, not failed), the file may hold a spent token.
// Run `login` again rather than finding out.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { chromium } from 'playwright';

const run = promisify(execFile);

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(site, '.capture');
const statePath = resolve(workspace, 'state.json');
const rawDir = resolve(workspace, 'raw');
const outDir = resolve(site, 'static/img/console');

/** Used when Playwright's own Chromium is not installed, which saves a download on this machine. */
const fallbackBrowsers = [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** The console at a desk's width. Two device pixels per CSS pixel so text survives the resize. */
const viewport = { width: 1440, height: 900 };
const deviceScaleFactor = 2;

/** What replaces a scrubbed string. Obviously not anybody. */
const scrubbedAs = 'operator@example.com';

const themes = ['carbon', 'white', 'neon'];

/**
 * Every page worth photographing, in the order the site uses them.
 *
 * `ready` is for a page whose content is not covered by a skeleton while it loads, so "no
 * skeletons" would be true too early. `open` is for a page reached by clicking rather than by URL.
 */
const targets = [
    { id: 'desk', path: '/' },
    { id: 'schedule.today', path: '/schedule?tab=today', ready: '#main svg' },
    { id: 'schedule.week', path: '/schedule?tab=week' },
    { id: 'voice.characters', path: '/voice?tab=characters' },
    { id: 'voice.said', path: '/voice?tab=said' },
    { id: 'voice.productions', path: '/voice?tab=productions' },
    { id: 'catalog.tracks', path: '/catalog/tracks' },
    { id: 'catalog.track', path: '/catalog/tracks', open: 'track', ready: '#main h1, #main h2' },
    { id: 'plugins', path: '/plugins' },
    { id: 'checkup', path: '/checkup' },
    { id: 'activity', path: '/activity' },
    { id: 'settings.llm', path: '/settings/llm' },
    { id: 'settings.appearance', path: '/settings/appearance' },
    { id: 'news', path: '/news' },
    { id: 'charts', path: '/charts' },
];

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        base: { type: 'string', default: 'https://radio.deanhome.app' },
        browser: { type: 'string' },
        only: { type: 'string' },
        track: { type: 'string' },
        theme: { type: 'string', default: 'carbon' },
        scrub: { type: 'string', multiple: true, default: [] },
        hide: { type: 'string', multiple: true, default: [] },
        'blur-art': { type: 'boolean', default: false },
        'keep-png': { type: 'boolean', default: false },
        settle: { type: 'string', default: '1500' },
    },
});

const base = values.base.replace(/\/+$/, '');
const command = positionals[0];

if (!themes.includes(values.theme)) fail(`--theme must be one of ${themes.join(', ')}.`);

if (command === 'login') await login();
else if (command === 'shoot') await shoot();
else fail('Usage: capture login | capture shoot [--only id,id] [--theme carbon|white|neon] [--scrub TEXT] [--hide TEXT] [--blur-art]');

function fail(message) {
    console.error(message);
    process.exit(1);
}

/** Playwright's own Chromium when it is installed, otherwise a browser this machine already has. */
function executablePath() {
    if (values.browser) return values.browser;
    if (existsSync(chromium.executablePath())) return undefined;
    const found = fallbackBrowsers.find(path => existsSync(path));
    if (!found) fail('No browser. Run `pnpm --filter @deadair/site exec playwright install chromium`, or pass --browser.');
    console.log(`Playwright's Chromium is not installed; using ${found}.`);
    return found;
}

async function login() {
    await mkdir(workspace, { recursive: true });
    const browser = await chromium.launch({ headless: false, executablePath: executablePath() });
    try {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await page.goto(`${base}/login`);
        console.log('Sign in in the window that opened. This waits for the console to appear.');
        // Ten minutes, because an emailed sign-in link is a trip to another app and back.
        await page.waitForURL(url => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/auth'), { timeout: 600_000 });
        await page.waitForSelector('#main', { timeout: 60_000 });
        await context.storageState({ path: statePath });
        console.log(`Signed in. The state is in ${statePath}.`);
    } finally {
        await browser.close();
    }
}

async function shoot() {
    if (!existsSync(statePath)) fail('No signed-in state. Run `capture login` first.');

    const only = values.only ? new Set(values.only.split(',').map(id => id.trim())) : undefined;
    const chosen = targets.filter(target => !only || only.has(target.id));
    if (chosen.length === 0) fail(`Nothing matches --only. The ids are: ${targets.map(target => target.id).join(', ')}.`);

    const scrub = values.scrub.map(text => text.trim()).filter(Boolean);
    const hide = values.hide.map(text => text.trim()).filter(Boolean);
    const settle = Number.parseInt(values.settle, 10);

    await mkdir(rawDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    const browser = await chromium.launch({ executablePath: executablePath() });
    const context = await browser.newContext({ storageState: statePath, viewport, deviceScaleFactor });
    // Before the console's own inline script reads it, so the first paint is already the theme asked
    // for and whatever the state file remembered is overridden.
    await context.addInitScript(theme => window.localStorage.setItem('da-theme', theme), values.theme);

    let saved = false;
    const save = async () => {
        await context.storageState({ path: statePath });
        saved = true;
    };

    try {
        const page = await context.newPage();
        for (const target of chosen) {
            await visit(page, target);
            // The first page redeemed the refresh cookie. Keep the one it was given in exchange.
            if (!saved) await save();

            if (target.open === 'track') await openTrack(page);
            await settleOn(page, target, settle);
            if (scrub.length > 0) await page.evaluate(scrubText, { needles: scrub, replacement: scrubbedAs });
            if (hide.length > 0) await page.evaluate(hideRows, hide);
            if (values['blur-art']) await page.addStyleTag({ content: 'img[src*="/api/"] { filter: blur(10px); }' });

            // Carbon is the site's own scheme, so it is the plain name and every other theme is a suffix.
            const name = values.theme === 'carbon' ? target.id : `${target.id}.${values.theme}`;
            await write(page, name);
        }
    } finally {
        // Whatever happened above, the cookie the browser holds now is the only one still good.
        await context
            .storageState({ path: statePath })
            .catch(error => console.error(`Could not save the signed-in state: ${error.message}. Run \`capture login\` before the next shoot.`));
        await browser.close();
    }
}

async function visit(page, target) {
    const url = target.id === 'catalog.track' && values.track ? `${base}/catalog/tracks/${values.track}` : `${base}${target.path}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Thrown rather than exited, so the `finally` in `shoot` still runs.
    if (page.url().includes('/login')) throw new Error('The console asked for a sign-in, so the saved state is no good. Run `capture login` again.');
    await page.waitForSelector('#main', { timeout: 30_000 });
}

/** The first record on the tracks page, unless --track already sent us to one. */
async function openTrack(page) {
    if (values.track) return;
    await waitForQuiet(page);
    const link = page.locator('#main a[href^="/catalog/tracks/"]:not([href="/catalog/tracks/"])').first();
    await link.click();
    await page.waitForURL(/\/catalog\/tracks\/[^/?]+/);
}

/**
 * Until the page has stopped arriving.
 *
 * Never `networkidle`: the console polls playout every two seconds and the director every five, so
 * the network is never idle on a page that is working. What "loaded" means here is what it means to
 * somebody looking: no skeletons, no spinners, every picture drawn, the faces in.
 */
async function settleOn(page, target, settle) {
    if (target.ready)
        await page.waitForSelector(target.ready, { timeout: 30_000 }).catch(() => console.warn(`${target.id}: ${target.ready} never appeared.`));
    await waitForQuiet(page);
    await page.waitForTimeout(settle);
}

async function waitForQuiet(page) {
    await page
        .waitForFunction(
            () =>
                document.querySelectorAll('#main .mantine-Skeleton-root, #main .mantine-Loader-root').length === 0 &&
                [...document.images].every(image => image.complete),
            undefined,
            { timeout: 30_000 },
        )
        // A page that is still spinning after half a minute is photographed as it is, and said so.
        .catch(() => console.warn(`${page.url()}: still loading after 30s; photographing it anyway.`));
    await page.evaluate(() => document.fonts.ready);
}

/** Runs in the page. Replaces each needle in text, input values and the attributes a tooltip reads. */
function scrubText({ needles, replacement }) {
    const swap = text => needles.reduce((result, needle) => result.split(needle).join(replacement), text);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const next = swap(node.nodeValue ?? '');
        if (next !== node.nodeValue) node.nodeValue = next;
    }
    for (const input of document.querySelectorAll('input, textarea')) input.value = swap(input.value);
    for (const element of document.querySelectorAll('[title], [aria-label]')) {
        for (const attribute of ['title', 'aria-label']) {
            const value = element.getAttribute(attribute);
            if (value) element.setAttribute(attribute, swap(value));
        }
    }
}

/**
 * Runs in the page. Hides every list row whose text contains one of the needles.
 *
 * A live station's lists hold whatever it wrote last: a bulletin read from somebody else's headline,
 * a phone-in on a subject nobody wants on a front page. This is how one of those is left out of a
 * picture without posing the rest. What is hidden is the nearest ancestor with at least two siblings
 * of its own tag and class: a table row or an entry in a feed, or a single line where a card is made
 * of lines like it. Look at the result, which is the only way to know which of those it was.
 */
function hideRows(needles) {
    const isRow = element => {
        const siblings = element.parentElement ? [...element.parentElement.children] : [];
        return siblings.filter(sibling => sibling.tagName === element.tagName && sibling.className === element.className).length >= 3;
    };
    const walker = document.createTreeWalker(document.querySelector('#main') ?? document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (needles.some(needle => (node.nodeValue ?? '').toLowerCase().includes(needle.toLowerCase()))) hits.push(node.parentElement);
    }
    for (let element of hits) {
        // A table's cells are siblings of one class too, and hiding one shifts the rest of its row
        // under the wrong headings. A table row or list item is always the row when there is one.
        const row = element?.closest('tr, li');
        if (row) {
            row.style.display = 'none';
            continue;
        }
        while (element && !isRow(element)) element = element.parentElement;
        if (element) element.style.display = 'none';
    }
}

async function write(page, name) {
    const png = resolve(rawDir, `${name}.png`);
    const webp = resolve(outDir, `${name}.webp`);
    await page.screenshot({ path: png });
    // 1920 wide is past anything the site draws a figure at, and half the 2880 the page was drawn at.
    await run('cwebp', ['-quiet', '-q', '80', '-resize', '1920', '0', png, '-o', webp]);
    if (!values['keep-png']) await rm(png);
    const { size } = await stat(webp);
    console.log(`${name.padEnd(28)} ${Math.round(size / 1024)} KB`);
}
