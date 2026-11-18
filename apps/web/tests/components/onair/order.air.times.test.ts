// When each row of the running order is projected to be heard. The rail on the desk is drawn from
// these, and its last point must agree with the "runs dry" sentence under it, so the cases below
// hold the two sums to each other as well as to the clock.

import { describe, expect, it } from 'vitest';
import type { PlayoutNowPlaying, StationOrderItem } from '@deadair/sdk';

import { airTimesOf, msUntilDry } from '../../../src/components/onair/order.runs.dry';
import { railOf } from '../../../src/components/onair/station.order.rules';

const NOW = 1_000_000;

const item = (overrides: Partial<StationOrderItem> = {}): StationOrderItem => ({
    id: 'item-1',
    kind: 'track',
    state: 'planned',
    title: 'Windowlicker',
    artists: ['Aphex Twin'],
    durationMs: 60_000,
    ...overrides,
});

const playing = (overrides: Partial<PlayoutNowPlaying> = {}): PlayoutNowPlaying => ({
    item: { id: 'b', pluginId: 'navidrome', externalId: 'x', title: 'On air', artists: [], durationMs: 60_000 },
    startedAt: NOW - 20_000,
    remainingMs: 40_000,
    ...overrides,
});

describe('airTimesOf', () => {
    it('places the item on air at its start and each one ahead after the last', () => {
        const times = airTimesOf(
            [item({ id: 'a', state: 'played' }), item({ id: 'b', state: 'airing' }), item({ id: 'c', state: 'handed' }), item({ id: 'd' })],
            playing(),
            NOW,
        );

        // The past is history, not projection.
        expect(times.byId.has('a')).toBe(false);
        expect(times.byId.get('b')).toEqual({ atMs: NOW - 20_000, atLeast: false });
        expect(times.byId.get('c')).toEqual({ atMs: NOW + 40_000, atLeast: false });
        expect(times.byId.get('d')).toEqual({ atMs: NOW + 100_000, atLeast: false });
        expect(times.dry).toEqual({ atMs: NOW + 160_000, atLeast: false });
    });

    it('runs dry exactly where msUntilDry says it does', () => {
        const items = [
            item({ id: 'b', state: 'airing' }),
            item({ id: 'c', kind: 'segment', durationMs: 20_000 }),
            item({ id: 'd', kind: 'segment', durationMs: 15_000, overAtMs: 5_000 }),
            item({ id: 'e', durationMs: 200_000 }),
        ];

        expect(airTimesOf(items, playing(), NOW).dry?.atMs).toBe(NOW + msUntilDry(items, 40_000)!);
    });

    it('adds nothing for a talk-over, and places it over the record after it', () => {
        const times = airTimesOf(
            [item({ id: 'b', state: 'airing' }), item({ id: 'c', kind: 'segment', durationMs: 20_000, overAtMs: 5_000 }), item({ id: 'd' })],
            playing(),
            NOW,
        );

        expect(times.byId.get('d')?.atMs).toBe(NOW + 40_000);
        expect(times.byId.get('c')?.atMs).toBe(NOW + 45_000);
        expect(times.dry?.atMs).toBe(NOW + 100_000);
    });

    it('places a talk-over at the end of the record before it when it is heard over that one', () => {
        const times = airTimesOf(
            [
                item({ id: 'b', state: 'airing' }),
                item({ id: 'c' }),
                item({ id: 'd', kind: 'segment', durationMs: 10_000, overAtMs: 50_000, overEndOf: true }),
            ],
            playing(),
            NOW,
        );

        expect(times.byId.get('d')?.atMs).toBe(NOW + 40_000 + 50_000);
    });

    it('flags everything after a record with no length rather than guessing one', () => {
        const times = airTimesOf([item({ id: 'b', state: 'airing' }), item({ id: 'c', durationMs: undefined }), item({ id: 'd' })], playing(), NOW);

        // The row itself still starts when it starts; it is what comes AFTER that is unknown.
        expect(times.byId.get('c')).toEqual({ atMs: NOW + 40_000, atLeast: false });
        expect(times.byId.get('d')).toEqual({ atMs: NOW + 40_000, atLeast: true });
        expect(times.dry).toEqual({ atMs: NOW + 100_000, atLeast: true });
    });

    it('flags everything ahead when the decoder cannot say how much is left', () => {
        const times = airTimesOf([item({ id: 'b', state: 'airing' }), item({ id: 'c' })], playing({ remainingMs: undefined }), NOW);

        expect(times.byId.get('b')?.atLeast).toBe(false);
        expect(times.byId.get('c')).toEqual({ atMs: NOW, atLeast: true });
    });

    it('projects nothing while nothing is going out', () => {
        const times = airTimesOf([item({ id: 'c' })], undefined, NOW);

        expect(times.byId.size).toBe(0);
        expect(times.dry).toBeUndefined();
    });

    it('has no dry point when nothing is ahead', () => {
        expect(airTimesOf([item({ id: 'b', state: 'airing' })], playing(), NOW).dry).toBeUndefined();
    });
});

describe('railOf', () => {
    const local = (hour: number, minute: number, second = 0) => new Date(2026, 10, 18, hour, minute, second).getTime();

    it('weaves hour headings in where the hour changes, and the dry point last', () => {
        const items = [item({ id: 'a', state: 'played' }), item({ id: 'b', state: 'airing' }), item({ id: 'c' }), item({ id: 'd' })];
        const entries = railOf(items, {
            byId: new Map([
                ['b', { atMs: local(13, 58, 40), atLeast: false }],
                ['c', { atMs: local(14, 2, 10), atLeast: false }],
                ['d', { atMs: local(14, 6), atLeast: true }],
            ]),
            dry: { atMs: local(15, 1), atLeast: true },
        });

        expect(entries.map(entry => (entry.kind === 'item' ? entry.item.id : entry.kind))).toEqual([
            'a',
            'hour',
            'b',
            'hour',
            'c',
            'd',
            'hour',
            'dry',
        ]);
        // Down to the minute, so a row's time does not move on every poll.
        expect(entries[2]).toMatchObject({ kind: 'item', atMs: local(13, 58), atLeast: false });
        expect(entries[5]).toMatchObject({ atLeast: true });
        expect(entries[3]).toMatchObject({ kind: 'hour', atMs: local(14, 0) });
    });

    it('gives a talk-over no heading of its own, since it is placed where it is heard', () => {
        const entries = railOf([item({ id: 'b', state: 'airing' }), item({ id: 'c', kind: 'segment', overAtMs: 5_000 }), item({ id: 'd' })], {
            byId: new Map([
                ['b', { atMs: local(13, 55), atLeast: false }],
                ['c', { atMs: local(14, 0, 5), atLeast: false }],
                ['d', { atMs: local(14, 0), atLeast: false }],
            ]),
        });

        expect(entries.map(entry => entry.kind)).toEqual(['hour', 'item', 'item', 'hour', 'item']);
    });
});
