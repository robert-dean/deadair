// The Marketplace listing's pictures: a thumbnail and three gallery images, each 1920 × 960, which is
// what Elgato's Maker Console asks for. Uploaded there by hand; the plugin package does not carry them.
//
//     node apps/streamdeck/tools/marketplace.media.mjs
//
// Run by hand on the rare day the keys change, on a Mac (`sips` does the rasterising), and the PNGs it
// writes into `apps/streamdeck/marketplace/` are committed, as the desktop's generated icons are.
//
// The keys are drawn by the plugin's OWN renderer (`src/display/key.image.ts`, imported through Node's
// type stripping), so a picture in the listing is what a key actually shows. The covers are abstract
// shapes drawn here and the records are made up: a listing is no place for somebody else's album art.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { nowPlayingSvg, PROGRESS_STEPS } from '../src/display/key.image.ts';

const here = resolve(import.meta.dirname, '..');
const plugin = join(here, 'radio.deadair.streamdeck.sdPlugin');
const out = join(here, 'marketplace');
const W = 1920;
const H = 960;
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const CARBON = '#0C0E0D';
const TEXT = '#E8EDEA';
const DIM = '#A7B2AC';
const PHOSPHOR = '#2FD98C';

const base64 = text => Buffer.from(text).toString('base64');
const svgUri = svg => `data:image/svg+xml;base64,${base64(svg)}`;
const fileUri = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An abstract cover: a gradient field and a few circles. Nobody's artwork. */
function cover(from, to, ink) {
    return svgUri(
        `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">` +
            `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
            `<rect width="300" height="300" fill="url(#g)"/>` +
            `<circle cx="190" cy="120" r="70" fill="${ink}" fill-opacity="0.85"/>` +
            `<circle cx="95" cy="205" r="42" fill="none" stroke="${ink}" stroke-width="10" stroke-opacity="0.6"/>` +
            `<rect x="30" y="40" width="80" height="10" rx="5" fill="${ink}" fill-opacity="0.5"/>` +
            `</svg>`,
    );
}

const COVERS = {
    dusk: cover('#FF7A7A', '#FFB224', '#2D1A52'),
    tide: cover('#58A6FF', '#2FD98C', '#0E3260'),
};

let clips = 0;

/** One key: the plugin's image, a rounded edge, and the title the Stream Deck app would draw over it. */
function key(x, y, size, image, title = '', label = '') {
    const id = `k${clips++}`;
    const lines = title.split('\n').filter(Boolean);
    const fontSize = size * 0.105;
    const titleSvg = lines
        .map((line, index) => {
            const ty = y + size * 0.93 - (lines.length - 1 - index) * fontSize * 1.15;
            // A shadow copy under the white, rather than an outline: `paint-order` is SVG 2, and the
            // renderer `sips` uses draws an outline over the letters instead of under them.
            const text = (dx, fill, opacity) =>
                `<text x="${x + size / 2 + dx}" y="${ty + dx}" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="${fontSize}" fill="${fill}" fill-opacity="${opacity}">${escape(line)}</text>`;
            return text(fontSize * 0.08, '#000000', 0.8) + text(0, '#FFFFFF', 1);
        })
        .join('');
    const labelSvg = label
        ? `<text x="${x + size / 2}" y="${y + size + 52}" text-anchor="middle" font-family="${FONT}" font-size="30" fill="${DIM}">${escape(label)}</text>`
        : '';
    return (
        `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.12}"/></clipPath>` +
        `<g clip-path="url(#${id})"><image x="${x}" y="${y}" width="${size}" height="${size}" xlink:href="${image}"/>${titleSvg}</g>` +
        `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.12}" fill="none" stroke="#2a302d" stroke-width="3"/>` +
        labelSvg
    );
}

const mark = fileUri(join(plugin, 'imgs/plugin/mark.png'), 'image/png');
const nowPlaying = (face, title) => ({ image: svgUri(nowPlayingSvg({ mark, ...face })), title });
const manifestKey = path => fileUri(join(plugin, path), 'image/svg+xml');

/** A headline and a line under it, top left. */
function heading(title, line) {
    return (
        `<text x="120" y="170" font-family="${FONT}" font-weight="700" font-size="76" fill="${TEXT}">${escape(title)}</text>` +
        `<text x="120" y="240" font-family="${FONT}" font-size="36" fill="${DIM}">${escape(line)}</text>`
    );
}

function page(body) {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
        `<rect width="${W}" height="${H}" fill="${CARBON}"/>` +
        `<rect x="0" y="${H - 10}" width="${W}" height="10" fill="${PHOSPHOR}"/>` +
        body +
        `</svg>`
    );
}

const playing = nowPlaying({ cover: COVERS.dusk, step: Math.round(PROGRESS_STEPS * 0.4), tone: 'live', stale: false }, 'Night Drive\nLow Frequen…');

const pages = {
    thumbnail: page(
        `<image x="150" y="230" width="420" height="420" xlink:href="${fileUri(join(plugin, 'imgs/plugin/icon@2x.png'), 'image/png')}"/>` +
            `<text x="660" y="400" font-family="${FONT}" font-weight="700" font-size="120" fill="${TEXT}">deadair</text>` +
            `<text x="664" y="480" font-family="${FONT}" font-size="46" fill="${DIM}">Your station on a Stream Deck</text>` +
            key(664, 560, 220, playing.image, playing.title) +
            key(914, 560, 220, manifestKey('imgs/actions/skip/key.svg')) +
            key(1164, 560, 220, manifestKey('imgs/actions/transport/stop.svg')),
    ),
    'gallery-1-now-playing': page(
        heading('What is on air', 'The cover, the title, and a bar that fills as the record plays. Press it to open the console.') +
            key(760, 320, 400, playing.image, playing.title),
    ),
    'gallery-2-transport': page(
        heading('Skip, and a Stop that asks twice', 'Stop says Confirm, and forgets after five seconds. Once stopped, the same key is Start.') +
            key(270, 360, 300, manifestKey('imgs/actions/skip/key.svg'), '', 'Skip') +
            key(650, 360, 300, manifestKey('imgs/actions/transport/stop.svg'), '', 'Stop') +
            key(1030, 360, 300, manifestKey('imgs/actions/transport/stop.svg'), 'Confirm', 'Pressed once') +
            key(1410, 360, 300, manifestKey('imgs/actions/transport/start.svg'), '', 'Start'),
    ),
    'gallery-3-states': page(
        heading('It says why it is quiet', 'In the console’s own words, and never in the on-air colour when the reading is old.') +
            key(270, 360, 300, nowPlaying({ tone: 'standby', stale: false }).image, 'ready', 'Waiting for a listener') +
            key(650, 360, 300, nowPlaying({ tone: 'off', stale: false }).image, 'off air', 'Stopped on purpose') +
            key(1030, 360, 300, nowPlaying({ cover: COVERS.tide, step: 20, tone: 'live', stale: true }).image, 'No station', 'Not answering') +
            key(1410, 360, 300, nowPlaying({ tone: 'off', stale: false }).image, 'Set up', 'No key yet'),
    ),
};

const work = mkdtempSync(join(tmpdir(), 'marketplace-'));
for (const [name, svg] of Object.entries(pages)) {
    const source = join(work, `${name}.svg`);
    writeFileSync(source, svg);
    execFileSync('sips', ['-s', 'format', 'png', source, '--out', join(out, `${name}.png`)], { stdio: 'ignore' });
    console.log(`marketplace/${name}.png`);
}
