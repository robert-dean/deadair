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
});

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
