// Photographs the deadair template's Add Container form on an Unraid server, scrubbed.
//
//   node scripts/unraid.capture.mjs login --base http://your-server
//   node scripts/unraid.capture.mjs shoot --base http://your-server [--scrub radio.example.com]
//
// `login` opens a window for a person to sign in; nothing here holds a password. `shoot` loads the
// deadair template, REPLACES every value in the form with a generic example, rewrites the field
// descriptions to the ones in the repository's current unraid/deadair.xml (a saved user template is
// whatever it was when it was installed), hides the server's own chrome, and writes one webp per
// section. It never submits the form, so nothing on the server changes.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { chromium } from 'playwright';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        base: { type: 'string', default: '' },
        out: { type: 'string', default: resolve(here, '../static/img/unraid') },
        // Anything else that names this operator: a public hostname, a share, a second address.
        scrub: { type: 'string', multiple: true, default: [] },
        state: { type: 'string', default: resolve(here, '../.capture/unraid.state.json') },
    },
});

const base = values.base.replace(/\/+$/, '');
// No default, for the same reason console.capture.mjs has none: nothing here names an operator's network.
if (!base) fail('Say which server to photograph: --base http://your-server');

const viewport = { width: 1440, height: 900 };
const fallbackBrowsers = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

function fail(message) {
    console.error(message);
    process.exit(1);
}

function executablePath() {
    if (existsSync(chromium.executablePath())) return undefined;
    const found = fallbackBrowsers.find(path => existsSync(path));
    if (!found) fail('No browser available.');
    return found;
}

/** Every value the form holds, replaced with a generic example of a `full` install. */
const EXAMPLES = {
    80: '8080',
    '/data': '/mnt/user/appdata/deadair',
    '/media': '',
    APP_BASE_URL: 'http://192.168.1.10:8080',
    SPA_BASE_URL: 'http://192.168.1.10:8080',
    TZ: 'America/New_York',
    KMS_LOCAL_ROOT_KEY: '',
    AUTHENTICATION_SESSION_JWT_PRIVATE_KEY: '',
    DATABASE_HOST: '',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'deadair',
    DATABASE_USER: '',
    DATABASE_PASSWORD: '',
    DATABASE_APP_USER: '',
    DATABASE_APP_PASSWORD: '',
    REDIS_HOST: '',
    REDIS_PORT: '6379',
    REDIS_USERNAME: '',
    REDIS_PASSWORD: '',
    REDIS_TLS: 'false',
    REDIS_URL: '',
    REAL_IP_FROM: '',
    REAL_IP_HEADER: 'X-Forwarded-For',
    MIGRATE_ON_BOOT: 'true',
};

/** The descriptions in the repository's template today, keyed by the line above them in the form. */
const DESCRIPTIONS = {
    'Container Port: 80': 'The console, the API and the stream, all on this one port.',
    'Container Path: /data':
        "What the station IS: its settings, presenters, schedule, pronunciations and ratings, installed plugins, the stream's own credentials, the audio you recorded yourself, logs — and, on the full tag, the database holding most of it. Small, authored, and the thing to back up. Belongs on the cache pool.",
    'Container Path: /media':
        "Optional, and only about size. What the station HOLDS rather than what it is: records downloaded before they air, cover art, the speech it rendered, voice previews, the speech model's weights. All of it can be produced again by running the station, and it grows to roughly the size of the library you play — so put it on the array and leave it out of your backups. Blank keeps it under Data, which is fine until the library gets big.",
    'Container Variable: APP_BASE_URL':
        "The address you type into a browser to reach this station, all of it: scheme, host and port, with nothing after the port. On your own network that is http:// with your server's address and the WebUI port above, such as http://192.168.1.10:8080; behind a proxy that terminates TLS it is the https:// name. Sign-in links and a music provider's authorization are sent back here, so a wrong value is a sign-in that lands nowhere. It does not decide whether the console loads.",
    'Container Variable: SPA_BASE_URL': 'The same address as the public address above, because one port serves the console and the API.',
    'Container Variable: TZ':
        'An IANA zone name such as America/New_York or Europe/London. The station reads the clock in this when it says the time and when it works out what half of the day it is; left unset a container reports UTC, which is a presenter saying "tonight" through your afternoon.',
    'Container Variable: KMS_LOCAL_ROOT_KEY':
        "Encrypts every credential the station stores, including your music provider's. Generate once with: openssl rand -hex 32 — it must be hex, and keep it. Losing it means entering all of them again.",
    'Container Variable: AUTHENTICATION_SESSION_JWT_PRIVATE_KEY':
        'Signs sessions, RS256, so it must be an RSA key. Generate one with: openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | base64 -w0 — a key is several lines and this field is one, so base64 it and paste that. Losing it signs everybody out and nothing worse.',
    'Container Variable: DATABASE_HOST':
        'Your PostgreSQL server, version 13 or newer (17 is what the station is tested on). No extensions needed. Leave every database and cache field blank on the full tag, which runs its own.',
    'Container Variable: REDIS_HOST':
        'Your Redis server. Sessions live here rather than in the database, so losing it signs everybody out and costs nothing else.',
    'Container Variable: REAL_IP_FROM':
        'Leave empty unless a tunnel or a reverse proxy sits in front of this station. When one does, every listener reaches the station as THAT, so they all share one rate limit and the listener count collapses to however many different players are tuned in. Naming the proxy here — an address or a CIDR, and 172.16.0.0/12 covers another container on this box — lets the station see who actually asked.',
    'Container Variable: MIGRATE_ON_BOOT':
        'Leave on unless you apply the schema yourself. An out-of-date schema otherwise degrades quietly rather than failing.',
};

const command = positionals[0];
if (command === 'login') await login();
else if (command === 'shoot') await shoot();
else fail('Usage: unraid.capture.mjs login|shoot --base http://server [--out dir]');

async function login() {
    await mkdir(dirname(values.state), { recursive: true });
    const browser = await chromium.launch({ headless: false, executablePath: executablePath() });
    try {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await page.goto(base);
        console.log('Sign in in the window that opened. This waits for the dashboard.');
        await page.waitForFunction(() => !/login/i.test(document.title), undefined, { timeout: 600_000 });
        await context.storageState({ path: values.state });
        console.log(`Signed in. State in ${values.state}`);
    } finally {
        await browser.close();
    }
}

async function shoot() {
    if (!existsSync(values.state)) fail('Run `login` first.');
    await mkdir(values.out, { recursive: true });

    const browser = await chromium.launch({ executablePath: executablePath() });
    const context = await browser.newContext({ storageState: values.state, viewport, deviceScaleFactor: 2 });
    try {
        const page = await context.newPage();
        await page.goto(`${base}/Docker/AddContainer`, { waitUntil: 'domcontentloaded' });
        // Not `waitForSelector('select')`: the first select on the page is a hidden preclear widget.
        await page.waitForFunction(
            () => [...document.querySelectorAll('select')].some(s => [...s.options].some(o => /my-deadair\.xml/.test(o.value))),
            undefined,
            { timeout: 60_000 },
        );

        // Load the template, which arrives holding whatever this server actually runs.
        await page.evaluate(() => {
            const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /my-deadair\.xml/.test(o.value)));
            if (!select) throw new Error('No deadair template on this server.');
            select.value = [...select.options].find(o => /my-deadair\.xml/.test(o.value)).value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        // The confTarget inputs are hidden, so wait on their count rather than on visibility.
        await page.waitForFunction(() => document.querySelectorAll('[name="confTarget[]"]').length > 10, undefined, { timeout: 60_000 });
        await page.waitForTimeout(2500);

        // What counts as identifying is derived rather than written down: the server this is pointed
        // at, the name it calls itself in its own title, and whatever else the caller names with
        // --scrub. Nothing in this file may name one operator's network.
        const host = new URL(base).host.replace(/:\d+$/, '');
        const report = await page.evaluate(
            ({ examples, descriptions, host, extra }) => {
                // 1. Every value becomes a generic example.
                for (const target of document.querySelectorAll('[name="confTarget[]"]')) {
                    let parent = target.parentElement;
                    let input = null;
                    for (let i = 0; i < 6 && parent && !input; i++) {
                        input = parent.querySelector('input[name="confValue[]"], select[name="confValue[]"]');
                        parent = parent.parentElement;
                    }
                    if (input && Object.prototype.hasOwnProperty.call(examples, target.value)) input.value = examples[target.value];
                }
                const repository = document.querySelector('input[name="contRepository"]');
                if (repository) repository.value = 'deadair/deadair:full';

                // 2. Descriptions become the ones the repository ships today.
                for (const [marker, text] of Object.entries(descriptions)) {
                    const label = [...document.querySelectorAll('span.orange-text')].find(e => e.textContent.trim() === marker);
                    const description = label?.parentElement.querySelectorAll('span.orange-text')[1];
                    if (description) description.textContent = text;
                }

                // 3. Anything left that names this server goes, in fields, text and attributes.
                const escape = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // The name this server calls itself, out of "<name>/AddContainer".
                const serverName = (document.title.split('/')[0] || '').trim();
                const terms = [host, ...extra, serverName].filter(Boolean);
                const dirty = new RegExp(terms.map(escape).join('|'), 'i');
                const swap = t => {
                    let out = t.replace(new RegExp(escape(host), 'g'), '192.168.1.10');
                    for (const term of extra) out = out.replace(new RegExp(escape(term), 'g'), 'radio.example.com');
                    if (serverName) out = out.replace(new RegExp('\\b' + escape(serverName) + '\\b', 'g'), 'server');
                    return out;
                };
                const leftovers = [];
                for (const field of document.querySelectorAll('input, select, textarea')) {
                    if (dirty.test(String(field.value || ''))) {
                        leftovers.push(field.name || field.id);
                        field.value = '';
                    }
                }
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = swap(node.nodeValue ?? '');
                for (const element of document.querySelectorAll('[title], [href]')) {
                    for (const attribute of ['title', 'href']) {
                        const value = element.getAttribute(attribute);
                        if (value && dirty.test(value)) element.setAttribute(attribute, swap(value));
                    }
                }

                // 4. The server's own chrome is not part of the form.
                for (const selector of ['#header', '#nav-block', '#menu', 'nav', '#footer', '.footer', '.upgrade_notice', '#unraid_logo']) {
                    document.querySelectorAll(selector).forEach(e => {
                        e.style.display = 'none';
                    });
                }

                return { leftovers, clean: !dirty.test(document.body.innerText) };
            },
            { examples: EXAMPLES, descriptions: DESCRIPTIONS, host, extra: values.scrub },
        );

        if (!report.clean) throw new Error('Something identifying is still on the page; not writing an image.');
        console.log(`scrubbed (${report.leftovers.length} leftover field(s) blanked)`);

        const sections = [
            { id: 'form', fromSel: 'select.template, select[name="template"], select', toSel: 'input[name="contRepository"]' },
            { id: 'required', from: 'WebUI:', to: 'Session key:' },
            { id: 'database', from: 'Database host:', to: 'Cache port:' },
            // The advanced view is not photographed. Clicking its toggle from a script leaves the
            // advanced rows hidden (they measure as zero-height), so the page describes those fields
            // in prose instead of showing them.
        ];

        /** The toggle at the top right of the form. Clicking it reveals the advanced fields. */
        async function setAdvanced(on) {
            const changed = await page.evaluate(wanted => {
                const label = wanted ? 'advanced view' : 'basic view';
                const toggle = [...document.querySelectorAll('a, span, div, label, button')].find(e => e.textContent.trim().toLowerCase() === label);
                if (!toggle) return 'no toggle';
                toggle.click();
                return 'clicked ' + label;
            }, on);
            await page.waitForTimeout(1200);
            return changed;
        }

        for (const section of sections) {
            if (section.advanced) console.log('advanced view:', await setAdvanced(true));
            const box = await page.evaluate(
                ({ from, to, fromSel, toSel }) => {
                    if (fromSel && toSel) {
                        const a = document.querySelector(fromSel);
                        const b = document.querySelector(toSel);
                        if (!a || !b) return null;
                        const top = a.getBoundingClientRect().top + window.scrollY - 40;
                        const bottom = b.getBoundingClientRect().bottom + window.scrollY + 60;
                        return { top: Math.max(0, top), bottom };
                    }
                    const find = text => {
                        const all = [...document.querySelectorAll('td, label, span, div')];
                        const hits = all.filter(e => e.textContent.trim().startsWith(text) && e.textContent.trim().length < text.length + 40);
                        return hits.length ? hits[hits.length - 1] : null;
                    };
                    const start = find(from);
                    const end = find(to);
                    if (!start || !end) return null;
                    const a = start.getBoundingClientRect();
                    const b = end.getBoundingClientRect();
                    const row = end.closest('tr, div');
                    const bottom = (row ? row.getBoundingClientRect().bottom : b.bottom) + window.scrollY;
                    return { top: a.top + window.scrollY - 24, bottom: bottom + 130 };
                },
                { from: section.from, to: section.to, fromSel: section.fromSel, toSel: section.toSel },
            );
            if (!box) {
                console.warn(`${section.id}: could not find its bounds, skipped.`);
                continue;
            }
            const height = Math.ceil(box.bottom - box.top);
            if (!Number.isFinite(height) || height < 120) {
                console.warn(`${section.id}: bounds came out ${height}px, skipped.`);
                continue;
            }
            const png = resolve(values.out, `${section.id}.png`);
            const webp = resolve(values.out, `${section.id}.webp`);
            await page.setViewportSize({ width: viewport.width, height: Math.min(2400, height) });
            await page.evaluate(top => window.scrollTo(0, top), box.top);
            await page.waitForTimeout(400);
            await page.screenshot({ path: png });
            await run('cwebp', ['-quiet', '-q', '82', '-resize', '1440', '0', png, '-o', webp]);
            await rm(png);
            console.log(`${section.id.padEnd(20)} ${height}px tall`);
        }
    } finally {
        await browser.close();
    }
}
