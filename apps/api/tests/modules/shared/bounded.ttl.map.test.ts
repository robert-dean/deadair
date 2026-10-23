import { describe, expect, it } from 'vitest';

import { BoundedTtlMap } from '../../../src/modules/shared/bounded.ttl.map.js';

describe('BoundedTtlMap', () => {
    it('answers a kept value while it is fresh, and nothing once it is older than the TTL', () => {
        const map = new BoundedTtlMap<string>(1_000, 10);
        map.set('a', 'answer', 0);

        expect(map.get('a', 999)).toBe('answer');
        expect(map.get('a', 1_000)).toBeUndefined();
        expect(map.get('never', 0)).toBeUndefined();
    });

    it('lets the oldest go once it holds as many as it may', () => {
        const map = new BoundedTtlMap<number>(60_000, 2);
        map.set('a', 1, 0);
        map.set('b', 2, 0);
        map.set('c', 3, 0);

        expect(map.get('a', 0)).toBeUndefined();
        expect(map.get('b', 0)).toBe(2);
        expect(map.get('c', 0)).toBe(3);
    });

    it('treats a key written again as the newest, so a refreshed answer is not the next to go', () => {
        const map = new BoundedTtlMap<number>(60_000, 2);
        map.set('a', 1, 0);
        map.set('b', 2, 0);
        map.set('a', 10, 5);
        map.set('c', 3, 5);

        expect(map.get('a', 5)).toBe(10);
        expect(map.get('b', 5)).toBeUndefined();
    });

    it('lists every value still held, fresh or not, and forgets them all on clear', () => {
        const map = new BoundedTtlMap<string>(1_000, 10);
        map.set('a', 'old', 0);
        map.set('b', 'new', 5_000);

        expect([...map.values()]).toEqual(['old', 'new']);
        map.clear();
        expect([...map.values()]).toEqual([]);
    });
});
