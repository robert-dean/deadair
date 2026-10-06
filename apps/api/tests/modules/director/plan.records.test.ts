// Which queued artists a refill holds back. The cooldown is measured start to start, the way
// `play_history` measures it against what aired, and back from where the new batch begins.

import { describe, expect, it } from 'vitest';

import { NOMINAL_TRACK_MS } from '../../../src/modules/director/air.estimate.js';
import { artistsQueuedWithin } from '../../../src/modules/director/plan.records.js';
import { artistKey } from '../../../src/modules/director/rotation.keys.js';
import type { StationLineupItem } from '../../../src/modules/director/station.lineup.js';

let next = 0;
const id = (): string => `item-${++next}`;

const record = (artist: string, durationMs?: number): StationLineupItem => ({
    id: id(),
    kind: 'track',
    state: 'planned',
    track: {
        pluginId: 'test',
        externalId: id(),
        title: `A record by ${artist}`,
        artists: [artist],
        artist,
        ...(durationMs === undefined ? {} : { durationMs }),
    },
});

const segment = (): StationLineupItem => ({ id: id(), kind: 'segment', state: 'planned', segmentId: id() });

const FOUR_MINUTES = 240_000;

describe('artistsQueuedWithin', () => {
    it('holds every artist whose record starts inside the cooldown of where the batch begins', () => {
        // Ten four-minute records: the batch begins forty minutes out. The first record starts
        // exactly a cooldown before that and is clear; every one after it is inside.
        const queue = Array.from({ length: 10 }, (_, index) => record(`Artist${index}`, FOUR_MINUTES));

        const held = artistsQueuedWithin(queue, 40);

        expect(held.has(artistKey(['Artist0']))).toBe(false);
        expect(held).toEqual(new Set(Array.from({ length: 9 }, (_, index) => artistKey([`Artist${index + 1}`]))));
    });

    it('reaches further back than the last few items, which is all the tail window covered', () => {
        // An artist six records from the end has half an hour of a forty-minute cooldown still to
        // run when the batch begins.
        const queue = [record('Early', FOUR_MINUTES), ...Array.from({ length: 5 }, (_, index) => record(`Later${index}`, FOUR_MINUTES))];

        expect(artistsQueuedWithin(queue, 40).has(artistKey(['Early']))).toBe(true);
    });

    it('counts an unmeasured record as an average one', () => {
        // Nine unmeasured records are forty and a half minutes, so the first of them is clear.
        const queue = Array.from({ length: 9 }, (_, index) => record(`Artist${index}`));
        expect(9 * NOMINAL_TRACK_MS).toBeGreaterThanOrEqual(40 * 60_000);

        expect(artistsQueuedWithin(queue, 40).has(artistKey(['Artist0']))).toBe(false);
        expect(artistsQueuedWithin(queue, 40).has(artistKey(['Artist1']))).toBe(true);
    });

    it('ignores segments, which have no artist and take no time', () => {
        const held = artistsQueuedWithin([record('One', FOUR_MINUTES), segment(), record('Two', FOUR_MINUTES)], 40);

        expect(held).toEqual(new Set([artistKey(['One']), artistKey(['Two'])]));
    });

    it('holds nobody with the cooldown off', () => {
        const queue = [record('One', FOUR_MINUTES)];

        expect(artistsQueuedWithin(queue, 0)).toEqual(new Set());
        expect(artistsQueuedWithin(queue, Number.NaN)).toEqual(new Set());
    });
});
