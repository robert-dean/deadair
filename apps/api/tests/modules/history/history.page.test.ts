// What a row turns into, and what it deliberately does not carry. The four optional fields are
// absent rather than null because "not set" is `undefined` everywhere else in this tree, and
// because a record aired straight from a provider genuinely has no catalog row behind it: there is
// no cover and no running time to report, and saying so with a missing key costs a client one
// check instead of two.

import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { toEntry, type HistoryRow } from '../../../src/modules/history/history.page.js';

const AIRED = DateTime.fromISO('2026-09-06T21:14:05.000Z');

const row = (overrides: Partial<HistoryRow> = {}): HistoryRow => ({
    id: 'row-1',
    airedAt: AIRED,
    title: 'Blue Monday',
    artists: 'New Order',
    album: null,
    artworkUrl: null,
    durationMs: null,
    trackId: null,
    ...overrides,
});

describe('toEntry', () => {
    it('carries what every airing has', () => {
        expect(toEntry(row())).toEqual({ id: 'row-1', airedAt: AIRED, title: 'Blue Monday', artists: 'New Order' });
    });

    it('leaves out what the catalog could not answer, rather than sending null', () => {
        const entry = toEntry(row());

        expect('album' in entry).toBe(false);
        expect('artworkUrl' in entry).toBe(false);
        expect('durationMs' in entry).toBe(false);
        expect('trackId' in entry).toBe(false);
    });

    it('carries the catalog half when there is one', () => {
        const entry = toEntry(row({ album: 'Power, Corruption & Lies', artworkUrl: 'art/abc', durationMs: 448_000, trackId: 'track-1' }));

        expect(entry.album).toBe('Power, Corruption & Lies');
        expect(entry.artworkUrl).toBe('art/abc');
        expect(entry.durationMs).toBe(448_000);
        expect(entry.trackId).toBe('track-1');
    });

    it('keeps the credit line whole', () => {
        // `artists` is one string on purpose. Splitting it back into a list is how "Earth, Wind &
        // Fire" becomes three acts, which is the bug `play_history` already carries a comment about.
        expect(toEntry(row({ artists: 'Earth, Wind & Fire' })).artists).toBe('Earth, Wind & Fire');
    });
});
