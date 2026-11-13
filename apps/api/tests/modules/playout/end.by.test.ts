// The record in front of a hard marker is cut at hand-over so it ends on the marker's time, against when
// the item on air actually started, how long it runs and the blend between the two. What is pinned: the
// cut lands a little LATE rather than early, nothing is ever lengthened, and a record whose start cannot
// be known plays to its end.

import { describe, expect, it } from 'vitest';

import { cutToEndBy, END_BY_GUARD_MS, nextStartsAt } from '../../../src/modules/playout/end.by.js';
import type { NowPlaying, RundownItem } from '../../../src/modules/playout/rundown.js';

const NINE = Date.UTC(2026, 10, 13, 9, 0);
const MINUTE = 60_000;

const record = (id: string, over: Partial<RundownItem> = {}): RundownItem => ({
    id,
    pluginId: 'test',
    externalId: id,
    title: id,
    artists: ['Somebody'],
    artist: 'Somebody',
    durationMs: 4 * MINUTE,
    ...over,
});

/** A record on air since 08:54, measured to play exactly four minutes, so it ends at 08:58. */
const onAir: NowPlaying = { item: record('on-air', { cueInMs: 1_000, cueOutMs: 241_000 }), startedAt: NINE - 6 * MINUTE };

describe('nextStartsAt', () => {
    it('is when the item on air ends, less the blend into the next', () => {
        expect(nextStartsAt(onAir, 0, NINE - 5 * MINUTE)).toBe(NINE - 2 * MINUTE);
        expect(nextStartsAt(onAir, 4_000, NINE - 5 * MINUTE)).toBe(NINE - 2 * MINUTE - 4_000);
    });

    it('reads a cut on the item on air, since that is the length the player was given', () => {
        expect(nextStartsAt({ ...onAir, item: { ...onAir.item, cutAtMs: 61_000 } }, 0, NINE - 6 * MINUTE)).toBe(NINE - 5 * MINUTE);
    });

    it('is now when nothing is on air, or when the item on air has overrun its length', () => {
        expect(nextStartsAt(undefined, 0, NINE)).toBe(NINE);
        expect(nextStartsAt(onAir, 0, NINE)).toBe(NINE);
    });

    it('is unknown when the item on air has no length anybody measured', () => {
        expect(nextStartsAt({ item: record('unmeasured', { durationMs: undefined }), startedAt: NINE - MINUTE }, 0, NINE)).toBeUndefined();
    });
});

describe('cutToEndBy', () => {
    const now = NINE - 5 * MINUTE;

    it('cuts the record to end on the instant, a moment late rather than early', () => {
        // It starts at 08:58 and has to be over by nine: two minutes of it, from where it starts reading.
        const cut = cutToEndBy(record('next', { cueInMs: 500, cueOutMs: 230_000, endBy: NINE }), onAir, 0, now);
        expect(cut.cutAtMs).toBe(500 + 2 * MINUTE + END_BY_GUARD_MS);
    });

    it('takes the blend into account, since the record starts that much sooner', () => {
        const cut = cutToEndBy(record('next', { endBy: NINE }), onAir, 4_000, now);
        expect(cut.cutAtMs).toBe(2 * MINUTE + 4_000 + END_BY_GUARD_MS);
    });

    it('leaves a record that ends before the instant anyway as it is', () => {
        const short = record('short', { durationMs: MINUTE, endBy: NINE });
        expect(cutToEndBy(short, onAir, 0, now)).toBe(short);
    });

    it('leaves a record with nothing to end by as it is', () => {
        const plain = record('plain');
        expect(cutToEndBy(plain, onAir, 0, now)).toBe(plain);
    });

    it('leaves the record whole when its start cannot be known', () => {
        const next = record('next', { endBy: NINE });
        expect(cutToEndBy(next, { item: record('unmeasured', { durationMs: undefined }), startedAt: now }, 0, now)).toBe(next);
    });

    it('does not cut a record to less than its own fade, which would be a sting rather than a record', () => {
        const next = record('next', { endBy: NINE - 2 * MINUTE + 1_000 });
        expect(cutToEndBy(next, onAir, 0, now)).toBe(next);
    });
});
