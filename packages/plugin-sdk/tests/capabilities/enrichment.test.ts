import { describe, expect, it } from 'vitest';

import { isUnanswered, unanswered } from '../../src/capabilities/enrichment.js';

describe('unanswered', () => {
    it('carries its reason through a JSON round trip, which `undefined` in an array would not', () => {
        const batch = JSON.parse(JSON.stringify([{}, unanswered('upstream answered 503')])) as unknown[];

        expect(isUnanswered(batch[0])).toBe(false);
        expect(isUnanswered(batch[1])).toBe(true);
        expect(batch[1]).toEqual({ unanswered: 'upstream answered 503' });
    });

    it('is not mistaken for a miss, an answer, or nothing at all', () => {
        expect(isUnanswered({})).toBe(false);
        expect(isUnanswered({ title: 'Idioteque' })).toBe(false);
        expect(isUnanswered(undefined)).toBe(false);
        expect(isUnanswered(null)).toBe(false);
        expect(isUnanswered({ unanswered: 1 })).toBe(false);
    });
});
