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
    it("carries the writer's own line for a listener, where the writer offered one", () => {
        // The row holds both: `label` is what the console calls this break and `listenerLabel` is
        // what a stream may. Nothing here decides which is which — the writer did.
        const track = segmentRundownTrack(segment({ kind: 'weather', label: 'Weather: Brooklyn', listenerLabel: 'Weather in Brooklyn' }));

        expect(track.title).toBe('Weather: Brooklyn');
        expect(track.listenerLabel).toBe('Weather in Brooklyn');
    });

    it('carries none for a break whose writer offered none, which is most of them', () => {
        expect(segmentRundownTrack(segment()).listenerLabel).toBeUndefined();
    });

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

    it('names a reading the station spoke itself by the piece and the series', () => {
        // The other way to be a programme, and the one this file's `source` check cannot see: a
        // reading is an ordinary `render` row, so what marks it is the context its beats carried
        // through the join. Without this the mount would name the station.
        const reading = segment({
            kind: 'narration',
            source: 'render',
            label: 'Chapter 4',
            durationMs: 612_000,
            context: { programme: true, showTitle: 'Frankenstein', episodeTitle: 'Chapter 4' },
        });

        expect(segmentRundownTrack(reading)).toMatchObject({
            title: 'Chapter 4',
            artists: ['Frankenstein'],
            artist: '',
            programme: true,
            durationMs: 612_000,
        });
    });

    it('still treats an ordinary break as the station talking', () => {
        // The context check must not catch a break: `programme` is written by exactly one path.
        const talk = segment({ kind: 'talk', source: 'render', label: 'Talk break', context: { itemId: 'track-1' } });

        expect(segmentRundownTrack(talk)).not.toHaveProperty('programme');
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
