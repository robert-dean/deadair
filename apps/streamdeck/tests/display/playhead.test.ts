import type { PlayoutNowPlaying } from '@deadair/sdk';
import { describe, expect, it } from 'vitest';

import { PlayheadClock, projectPlayhead, TICK_MS } from '../../src/display/playhead.js';
import { record } from '../fixtures/playout.status.js';

const playing: PlayoutNowPlaying = { item: { ...record, durationMs: 200_000 }, startedAt: 1_000, remainingMs: 150_000 };

describe('projectPlayhead', () => {
    it('reads the decoder’s countdown against the record’s length', () => {
        expect(projectPlayhead(playing, 0)).toEqual({ elapsedMs: 50_000, remainingMs: 150_000, durationMs: 200_000, fraction: 0.25 });
    });

    it('carries the countdown forward between readings', () => {
        expect(projectPlayhead(playing, 10_000)?.remainingMs).toBe(140_000);
    });

    it('stops at the end rather than running past it, and never reads more than the record holds', () => {
        expect(projectPlayhead(playing, 1_000_000)).toMatchObject({ remainingMs: 0, fraction: 1 });
        expect(projectPlayhead({ ...playing, remainingMs: 900_000 }, 0)).toMatchObject({ remainingMs: 200_000, fraction: 0 });
    });

    it('refuses to guess without a length or a countdown', () => {
        expect(projectPlayhead(undefined, 0)).toBeUndefined();
        expect(projectPlayhead({ ...playing, remainingMs: undefined }, 0)).toBeUndefined();
        expect(projectPlayhead({ ...playing, item: { ...record, durationMs: undefined } }, 0)).toBeUndefined();
        expect(projectPlayhead({ ...playing, item: { ...record, durationMs: 0 } }, 0)).toBeUndefined();
    });
});

describe('PlayheadClock', () => {
    it('counts ticks, and starts over on a new reading', () => {
        const clock = new PlayheadClock();
        expect(clock.carriedFor(playing)).toBe(0);
        clock.tick();
        clock.tick();
        expect(clock.carriedFor(playing)).toBe(2 * TICK_MS);
        expect(clock.carriedFor({ ...playing, remainingMs: 148_000 })).toBe(0);
        clock.tick();
        expect(clock.carriedFor({ ...playing, item: { ...record, id: 'item-2' }, remainingMs: 148_000 })).toBe(0);
    });
});
