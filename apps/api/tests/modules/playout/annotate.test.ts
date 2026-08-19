// `levelingEnabled` is a record-only knob: it stops `gainAnnotations` from asking `gainFor` at all,
// and it must not reach a break, which has no live follower behind it the way a record has
// `normalize` in `radio.liq` — see `AnnotationContext.levelingEnabled` and `gain.ts`'s
// `DEFAULT_LEVELING_ENABLED` for why.

import { describe, expect, it } from 'vitest';

import { itemAnnotations, type AnnotationContext } from '../../../src/modules/playout/annotate.js';
import { DEFAULT_SPEECH_TRIM_DB, DEFAULT_TARGET_LUFS, speechGainFor } from '../../../src/modules/playout/gain.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';
import type { RundownItem } from '../../../src/modules/playout/rundown.js';

const context = (levelingEnabled: boolean): AnnotationContext => ({
    targetLufs: DEFAULT_TARGET_LUFS,
    speechTrimDb: DEFAULT_SPEECH_TRIM_DB,
    levelingEnabled,
    crossfade: false,
    stationName: STATION_NAME,
});

const STATION_NAME = 'Deadair';

const record = (loudnessLufs: number): RundownItem => ({
    id: 'item-1',
    pluginId: 'deadair.spotify',
    externalId: 'ext-1',
    title: 'A Record',
    artists: ['An Artist'],
    artist: 'An Artist',
    loudnessLufs,
    truePeakDb: -6,
});

const speech = (loudnessLufs: number): RundownItem => ({
    id: 'item-2',
    pluginId: RENDER_PLUGIN_ID,
    externalId: 'ext-2',
    title: 'A Break',
    artists: [],
    artist: '',
    loudnessLufs,
    truePeakDb: -6,
});

describe('gainAnnotations, through itemAnnotations', () => {
    it('stamps a measured record when leveling is on', () => {
        const annotations = itemAnnotations(record(-9), context(true));

        expect(annotations.liq_amplify).toBeDefined();
    });

    it('stamps nothing for a record when leveling is off, however loud or quiet it is', () => {
        const annotations = itemAnnotations(record(-9), context(false));

        expect(annotations.liq_amplify).toBeUndefined();
    });

    it('still stamps a break when leveling is off, exactly as when it is on', () => {
        const off = itemAnnotations(speech(-9), context(false));
        const on = itemAnnotations(speech(-9), context(true));

        const expected = `${speechGainFor({ loudnessLufs: -9 }, DEFAULT_TARGET_LUFS, DEFAULT_SPEECH_TRIM_DB)} dB`;
        expect(off.liq_amplify).toBe(expected);
        expect(on.liq_amplify).toBe(expected);
    });
});

// A segment's title is `segments.label`, which is written for a producer. The mount is the one
// place it must not reach: it is the whole display ceiling on a hardware player, so a break
// captioned `Talk break: X into Y` spends it on the station's own paperwork. See `listenerTitle`.
describe('listenerTitle, through itemAnnotations', () => {
    const labelled = (title: string): RundownItem => ({ ...speech(-16), title });

    it('labels a break with the station name rather than the producer label it carries', () => {
        const annotations = itemAnnotations(labelled('Talk break: Straight Tequila Night into My Boo'), context(true));

        expect(annotations.title).toBe(STATION_NAME);
    });

    it('labels every kind of segment the same way, so no vocabulary has to be kept in step', () => {
        for (const label of ['Talk break: A into B', 'Back-announce: A', 'Intro: B', 'Station ident', 'News']) {
            expect(itemAnnotations(labelled(label), context(true)).title).toBe(STATION_NAME);
        }
    });

    // The asymmetry is the point: a record has a real title and a listener wants it.
    it('leaves a record alone', () => {
        expect(itemAnnotations(record(-9), context(true)).title).toBe('A Record');
    });

    // A blank title leaves the mount saying whatever it last said, which is the record BEFORE the
    // break — a display naming a record that has finished misinforms rather than merely over-shares.
    it('falls back to the label when the station has no name, rather than sending nothing', () => {
        const unnamed = { ...context(true), stationName: '   ' };

        expect(itemAnnotations(labelled('Talk break: A into B'), unnamed).title).toBe('Talk break: A into B');
    });

    // `artists` is empty for a segment, so the ICY line Icecast composes is the bare station name.
    it('sends no artist for a break, so the mount does not read as a band nobody has heard of', () => {
        expect(itemAnnotations(labelled('Station ident'), context(true)).artist).toBeUndefined();
    });
});
