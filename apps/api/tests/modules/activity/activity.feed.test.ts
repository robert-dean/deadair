// The half of the feed that is not SQL: the cursor, and the sentences for the two sources that
// hold facts rather than words. Testable without a database, for the same reason
// `silence.diagnosis.ts` is.

import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';

import { decodeCursor, encodeCursor, toEntry, type FeedRow } from '../../../src/modules/activity/activity.feed.js';

const at = DateTime.fromISO('2026-08-13T03:14:15.926Z', { zone: 'utc' });

const row = (over: Partial<FeedRow> = {}): FeedRow => ({
    id: '11111111-1111-1111-1111-111111111111',
    at,
    module: 'playout',
    kind: 'silence.cause',
    severity: 'info',
    detail: null,
    data: null,
    segmentId: null,
    trackId: null,
    ...over,
});

describe('the feed cursor', () => {
    it('round-trips a moment and a row', () => {
        const cursor = decodeCursor(encodeCursor(row()));

        expect(cursor?.id).toBe('11111111-1111-1111-1111-111111111111');
        expect(cursor?.at.toMillis()).toBe(at.toMillis());
    });

    it('carries the row as well as the moment, because a moment is not unique', () => {
        // Two events in the same millisecond are ordinary: a stand-down writes one and the poll
        // behind it writes another. A cursor holding only the timestamp would skip the second or
        // serve it twice, depending on which way the comparison fell.
        const first = encodeCursor(row({ id: 'a' }));
        const second = encodeCursor(row({ id: 'b' }));

        expect(first).not.toBe(second);
    });

    it('reads anything it did not write as no cursor at all', () => {
        // The value reaches the query straight off the wire, so a caller passing junk asks for the
        // head of the feed rather than for an error page.
        expect(decodeCursor(undefined)).toBeUndefined();
        expect(decodeCursor('')).toBeUndefined();
        expect(decodeCursor('nonsense')).toBeUndefined();
        expect(decodeCursor('|an-id')).toBeUndefined();
        expect(decodeCursor('2026-08-13T03:14:15.926Z|')).toBeUndefined();
        expect(decodeCursor('not-a-date|an-id')).toBeUndefined();
    });

    it('keeps an id that contains the separator', () => {
        // The split is on the FIRST separator, so an id nobody promised was uuid-shaped survives.
        expect(decodeCursor(encodeCursor(row({ id: 'a|b' })))?.id).toBe('a|b');
    });
});

describe('what an entry says', () => {
    it('leaves a station event alone, because its producer already phrased it', () => {
        const entry = toEntry(row({ detail: 'The station is airing.', data: { cause: 'airing' } }));

        expect(entry.detail).toBe('The station is airing.');
        expect(entry.data).toEqual({ cause: 'airing' });
    });

    it('writes a sentence for a segment transition, which is a state and an id', () => {
        const entry = toEntry(row({ module: 'render', kind: 'segment.ready', detail: null, data: { label: 'Top of the hour' }, segmentId: 'seg-1' }));

        expect(entry.detail).toBe('Top of the hour is ready to air.');
        expect(entry.segmentId).toBe('seg-1');
    });

    it('carries the reason on a segment that failed, which is the whole point of reading it', () => {
        const entry = toEntry(
            row({
                module: 'render',
                kind: 'segment.failed',
                severity: 'fault',
                data: { label: 'A talk break', reason: 'no speech plugin is configured' },
            }),
        );

        expect(entry.detail).toBe('A talk break could not be made: no speech plugin is configured');
    });

    it('says something rather than nothing for a state it has no words for', () => {
        // States are added to `segments` before this file hears about them, and a feed line reading
        // `undefined` is worse than one reading the state's own name.
        const entry = toEntry(row({ module: 'render', kind: 'segment.mixing', data: { label: 'An ident' } }));

        expect(entry.detail).toBe('An ident moved to mixing.');
    });

    it('writes a sentence for a record that aired', () => {
        const entry = toEntry(row({ module: 'director', kind: 'track.aired', data: { title: 'A Track', artists: 'An Artist' }, trackId: 'trk-1' }));

        expect(entry.detail).toBe('A Track by An Artist aired.');
        expect(entry.trackId).toBe('trk-1');
    });

    it('still says a record aired when the row cannot say which', () => {
        expect(toEntry(row({ module: 'director', kind: 'track.aired', data: {} })).detail).toBe('A record aired.');
        expect(toEntry(row({ module: 'director', kind: 'track.aired', data: { title: 'A Track' } })).detail).toBe('A Track aired.');
    });

    it('leaves an empty data object off the entry entirely', () => {
        // `jsonb_strip_nulls` can empty it, and an empty object on the wire reads as "there is more
        // here" to a console deciding whether to offer a detail view.
        expect(toEntry(row({ detail: 'Something happened.', data: {} })).data).toBeUndefined();
    });
});
