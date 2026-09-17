// The manifest's key pictures, which the Stream Deck app shows in the action list and on a key before
// the plugin has drawn anything. Drawn by the plugin's own renderer, so each is the face a quiet key
// shows and none of them can drift from what the plugin actually puts on the key.
//
//     node apps/streamdeck/tools/default.key.mjs
//
// Run by hand when the mark or the renderer's quiet face changes, and commit what it writes. Node runs
// `key.image.ts` straight through its type stripping, which works because that file imports types alone.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { nowPlayingSvg, voteSvg } from '../src/display/key.image.ts';

const plugin = resolve(import.meta.dirname, '../radio.deadair.streamdeck.sdPlugin');
const picture = name => `data:image/png;base64,${readFileSync(join(plugin, `imgs/plugin/${name}`)).toString('base64')}`;
const mark = picture('mark.png');
const skull = picture('skull.png');
const write = (path, svg) => {
    writeFileSync(join(plugin, path), `${svg}\n`);
    console.log(`radio.deadair.streamdeck.sdPlugin/${path}`);
};

write('imgs/actions/now-playing/key.svg', nowPlayingSvg({ tone: 'standby', stale: false, shade: false, mark }));

// A vote key's quiet face: the station has no such opinion of whatever is on, which is what an
// unplaced key and one on a station with nothing airing both show.
for (const vote of ['liked', 'disliked']) {
    write(`imgs/actions/${vote === 'liked' ? 'like' : 'dislike'}/key.svg`, voteSvg({ vote, lit: false, dim: false, skull }));
}
