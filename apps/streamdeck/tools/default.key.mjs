// The Now Playing key's picture in the manifest, which the Stream Deck app shows in the action list
// and on a key before the plugin has drawn anything. Drawn by the plugin's own renderer, so it is the
// face a quiet key shows (the station's mark, no title, no bar) and cannot drift from it.
//
//     node apps/streamdeck/tools/default.key.mjs
//
// Run by hand when the mark or the renderer's quiet face changes, and commit what it writes. Node runs
// `key.image.ts` straight through its type stripping, which works because that file imports types alone.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { nowPlayingSvg } from '../src/display/key.image.ts';

const plugin = resolve(import.meta.dirname, '../radio.deadair.streamdeck.sdPlugin');
const mark = `data:image/png;base64,${readFileSync(join(plugin, 'imgs/plugin/mark.png')).toString('base64')}`;
writeFileSync(join(plugin, 'imgs/actions/now-playing/key.svg'), `${nowPlayingSvg({ tone: 'standby', stale: false, shade: false, mark })}\n`);
console.log('radio.deadair.streamdeck.sdPlugin/imgs/actions/now-playing/key.svg');
