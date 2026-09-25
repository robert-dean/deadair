import { describe, expect, it } from 'vitest';

import { PRODUCTION_SHELF_LIFE_MS, productionExpired, standingCall } from '../../../src/modules/director/production.shelf.js';

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
});
