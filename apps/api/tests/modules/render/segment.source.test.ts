import { describe, expect, it } from 'vitest';

import { RENDER_PLUGIN_ID, segmentRundownTrack } from '../../../src/modules/render/segment.source.js';
import type { Segment } from '../../../src/modules/render/segment.repository.js';

const segment = (overrides: Partial<Segment> = {}): Segment =>
    ({
        id: 'seg-1',
        kind: 'ident',
        state: 'ready',
        label: 'Station ident',
        source: 'library',
        pads: [],
        ...overrides,
    }) as Segment;

describe('segmentRundownTrack', () => {
    it('makes an ordinary segment the station talking, with no artist to be identified by', () => {
        expect(segmentRundownTrack(segment({ durationMs: 4_000 }))).toEqual({
            pluginId: RENDER_PLUGIN_ID,
            externalId: 'seg-1',
            title: 'Station ident',
            artists: [],
            artist: '',
            durationMs: 4_000,
        });
    });

    it('names an episode of somebody else’s programme by the episode and the show', () => {
        const carried = segment({
            kind: 'syndicated',
            source: 'syndicated',
            label: 'The Long Wave: Episode 12',
            durationMs: 3_723_000,
            context: { showTitle: 'The Long Wave', episodeTitle: 'Episode 12', artworkUrl: 'https://cdn.example.com/12.jpg' },
        });

        expect(segmentRundownTrack(carried)).toEqual({
            pluginId: RENDER_PLUGIN_ID,
            externalId: 'seg-1',
            title: 'Episode 12',
            artists: ['The Long Wave'],
            // Still empty: identity is taken from this, and a show's name would put a programme into
            // the key space the repeat window and the artist cooldown read.
            artist: '',
            programme: true,
            durationMs: 3_723_000,
            artworkUrl: 'https://cdn.example.com/12.jpg',
        });
    });

    it('falls back to the label for an episode whose context something has mangled', () => {
        const mangled = segment({ source: 'syndicated', label: 'The Long Wave: Episode 12', context: { artworkUrl: 'javascript:alert(1)' } });

        expect(segmentRundownTrack(mangled)).toEqual({
            pluginId: RENDER_PLUGIN_ID,
            externalId: 'seg-1',
            title: 'The Long Wave: Episode 12',
            artists: [],
            artist: '',
            programme: true,
        });
    });
});
