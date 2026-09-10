// A private-range predicate and the process-lifetime reading behind the middleware's "every
// listener arrives as one address" attention item. See forwarded.reading.ts for what a single hop
// actually means and why this is memory rather than a table.

import { beforeEach, describe, expect, it } from 'vitest';

import { isPrivateOrLoopback, noteSingleHop, readForwardedHop, resetForwardedHop } from '../../../src/modules/shared/forwarded.reading.js';

describe('isPrivateOrLoopback', () => {
    it.each([
        ['127.0.0.1', true],
        ['127.255.255.255', true],
        ['10.0.0.1', true],
        ['10.255.255.255', true],
        ['172.16.0.1', true],
        ['172.31.255.255', true],
        ['192.168.1.1', true],
        ['::1', true],
        ['fc00::1', true],
        ['fd00::1', true],
        ['::ffff:127.0.0.1', true],
        ['::ffff:10.1.2.3', true],
        ['203.0.113.7', false],
        ['172.15.0.1', false],
        ['172.32.0.1', false],
        ['9.9.9.9', false],
        ['2001:db8::1', false],
        ['::ffff:203.0.113.7', false],
    ])('answers %s for %s', (address, expected) => {
        expect(isPrivateOrLoopback(address)).toBe(expected);
    });
});

describe('the forwarded-hop reading', () => {
    beforeEach(() => {
        resetForwardedHop();
    });

    it('holds nothing until something is noted', () => {
        expect(readForwardedHop()).toBeUndefined();
    });

    it('records the address, a count of one, and the moment it was seen', () => {
        noteSingleHop('172.18.0.4', 1_700_000_000_000);

        expect(readForwardedHop()).toEqual({ address: '172.18.0.4', count: 1, lastSeenAt: new Date(1_700_000_000_000).toISOString() });
    });

    it('counts repeats against the same address and advances the timestamp', () => {
        noteSingleHop('172.18.0.4', 1_700_000_000_000);
        noteSingleHop('172.18.0.4', 1_700_000_001_000);

        expect(readForwardedHop()).toEqual({ address: '172.18.0.4', count: 2, lastSeenAt: new Date(1_700_000_001_000).toISOString() });
    });

    it('restarts the count for a different address rather than adding to it', () => {
        noteSingleHop('172.18.0.4', 1_700_000_000_000);
        noteSingleHop('172.18.0.5', 1_700_000_001_000);

        expect(readForwardedHop()).toEqual({ address: '172.18.0.5', count: 1, lastSeenAt: new Date(1_700_000_001_000).toISOString() });
    });

    it('forgets everything once reset, which tests rely on', () => {
        noteSingleHop('172.18.0.4');
        resetForwardedHop();

        expect(readForwardedHop()).toBeUndefined();
    });
});
