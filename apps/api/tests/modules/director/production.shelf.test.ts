import { describe, expect, it } from 'vitest';

import { PRODUCTION_SHELF_LIFE_MS, productionExpired, productionLanding, standingCall } from '../../../src/modules/director/production.shelf.js';
import type { StationLineupItem } from '../../../src/modules/director/station.lineup.js';

describe('productionExpired', () => {
    const now = 10 * PRODUCTION_SHELF_LIFE_MS;

    it('keeps a production inside its hour', () => {
        expect(productionExpired({ createdAt: now - PRODUCTION_SHELF_LIFE_MS + 1 }, now)).toBe(false);
    });

    it('retires one that has reached it', () => {
        expect(productionExpired({ createdAt: now - PRODUCTION_SHELF_LIFE_MS }, now)).toBe(true);
    });

    it('measures a scheduled one from its slot, which it was written for', () => {
        const createdAt = now - 3 * PRODUCTION_SHELF_LIFE_MS;

        expect(productionExpired({ createdAt, scheduledFor: now - 60_000 }, now)).toBe(false);
        expect(productionExpired({ createdAt, scheduledFor: now - PRODUCTION_SHELF_LIFE_MS }, now)).toBe(true);
    });
});

describe('standingCall', () => {
    const kinds = new Set(['callin']);

    it('is a conversation nobody scheduled and nobody asked for', () => {
        expect(standingCall({ kind: 'callin' }, kinds)).toBe(true);
        expect(standingCall({ kind: ' CallIn ' }, kinds)).toBe(true);
    });

    it('is not one the format clock scheduled', () => {
        expect(standingCall({ kind: 'callin', scheduledFor: 1 }, kinds)).toBe(false);
    });

    it('is not one somebody at the desk asked for', () => {
        expect(standingCall({ kind: 'callin', actorId: 'operator-1' }, kinds)).toBe(false);
    });

    it('is not a production that is not a conversation', () => {
        expect(standingCall({ kind: 'podcast' }, kinds)).toBe(false);
    });

    // `dialogueKinds` always adds both, so the set here is the one the director really reads.
    it('is not a banter or a visit, which are dialogue without being calls', () => {
        const withPresenters = new Set(['callin', 'visit', 'banter']);

        expect(standingCall({ kind: 'banter' }, withPresenters)).toBe(false);
        expect(standingCall({ kind: ' Banter ' }, withPresenters)).toBe(false);
        expect(standingCall({ kind: 'visit' }, withPresenters)).toBe(false);
        expect(standingCall({ kind: 'callin' }, withPresenters)).toBe(true);
    });
});

// A podcast asked for at eleven at night aired the moment its last beat was joined: the time was
// stored and nothing read it. These pin the placement to the time instead.
describe('productionLanding', () => {
    const MINUTE = 60_000;
    const START = Date.UTC(2026, 9, 12, 22, 0);
    let next = 0;
    const track = (): StationLineupItem => ({
        id: `item-${++next}`,
        kind: 'track',
        state: 'planned',
        track: { pluginId: 'test', externalId: `ext-${next}`, title: 'A record', artists: ['Somebody'], artist: 'Somebody', durationMs: 4 * MINUTE },
    });
    const talk = (): StationLineupItem => ({
        id: `item-${++next}`,
        kind: 'segment',
        state: 'planned',
        segmentId: `seg-${next}`,
        segmentKind: 'talk',
    });
    // Six four-minute records from ten o'clock: boundaries at 22:00, 22:04, 22:08 and so on.
    const order = () => [track(), track(), track(), track(), track(), track()];
    const clock = { anchorAt: START, from: 0 };

    it('takes the first open boundary past the head when nobody gave it a time', () => {
        expect(productionLanding(order(), 1, clock, undefined)).toBe(1);
    });

    it('waits for the first boundary at or after its time', () => {
        // 22:10 falls inside the third record, so the boundary after it, 22:12, is index 3.
        expect(productionLanding(order(), 1, clock, START + 10 * MINUTE)).toBe(3);
        expect(productionLanding(order(), 1, clock, START + 12 * MINUTE)).toBe(3);
    });

    it('has nowhere to go while the order does not reach its time', () => {
        expect(productionLanding(order(), 1, clock, START + 3 * 60 * MINUTE)).toBeUndefined();
    });

    it('airs at the head once its time has passed', () => {
        expect(productionLanding(order(), 2, clock, START - MINUTE)).toBe(2);
    });

    it('walks past a talk break at the boundary its time lands on', () => {
        const items = order();
        items.splice(3, 0, talk());

        // The boundary at 22:12 is the talk break's, and the one behind it has the break in front, so
        // the first open boundary is the one after the record that follows.
        expect(productionLanding(items, 1, clock, START + 12 * MINUTE)).toBe(5);
    });
});
