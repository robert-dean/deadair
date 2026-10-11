// Which kept session a guest carries on with, and that the page still works when the browser will not
// keep anything at all.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { forgetGuest, GUEST_STORAGE_KEY, loadGuest, passFromHash, saveGuest, usableGuest } from '../../src/party/party.session';

const NOW = new Date('2026-10-11T20:00:00Z');
const kept = (pass: string, expiresAt: string) => ({ pass, accessToken: 'jwt', expiresAt });

afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
});

describe('passFromHash', () => {
    it('reads the pass after #, and nothing when there is none', () => {
        expect(passFromHash('#dp_abc')).toBe('dp_abc');
        expect(passFromHash('#dp_a%2Bb')).toBe('dp_a+b');
        expect(passFromHash('')).toBeUndefined();
        expect(passFromHash('#')).toBeUndefined();
    });
});

describe('usableGuest', () => {
    it('carries on with a session from this party that has not run out', () => {
        expect(usableGuest(kept('dp_a', '2026-10-11T23:00:00Z'), 'dp_a', NOW)?.pass).toBe('dp_a');
    });

    it('joins afresh for a new party’s code, or once the session has run out', () => {
        expect(usableGuest(kept('dp_a', '2026-10-11T23:00:00Z'), 'dp_b', NOW)).toBeUndefined();
        expect(usableGuest(kept('dp_a', '2026-10-11T19:00:00Z'), 'dp_a', NOW)).toBeUndefined();
    });

    it('carries on with any live one after a reload, when the address no longer holds the code', () => {
        expect(usableGuest(kept('dp_a', '2026-10-11T23:00:00Z'), undefined, NOW)?.pass).toBe('dp_a');
    });
});

describe('storage', () => {
    it('keeps a session and gives it back, then forgets it', () => {
        saveGuest('dp_a', { accessToken: 'jwt', expiresAt: DateTime.fromISO('2026-10-11T23:00:00Z') });
        expect(loadGuest()).toEqual({ pass: 'dp_a', accessToken: 'jwt', expiresAt: '2026-10-11T23:00:00.000Z' });
        forgetGuest();
        expect(loadGuest()).toBeUndefined();
    });

    it('ignores something under its key it did not write', () => {
        window.localStorage.setItem(GUEST_STORAGE_KEY, '{"pass":1}');
        expect(loadGuest()).toBeUndefined();
    });

    it('works with nothing kept when the browser refuses to keep anything', () => {
        // A private window, or site data blocked: reaching for storage at all throws.
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(saveGuest('dp_a', { accessToken: 'jwt', expiresAt: DateTime.utc() }).accessToken).toBe('jwt');
        expect(loadGuest()).toBeUndefined();
    });
});
