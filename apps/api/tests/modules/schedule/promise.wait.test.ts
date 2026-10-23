import { describe, expect, it } from 'vitest';

import { PROMISE_GRACE_MS, PROMISE_UNKNOWN_LENGTH_MS, promiseStillHeld } from '../../../src/modules/schedule/promise.wait.js';

describe('promiseStillHeld', () => {
    it('believes a break until its end plus the time for a tick to come round', () => {
        expect(promiseStillHeld(0, 37_000, 37_000 + PROMISE_GRACE_MS - 1)).toBe(true);
        expect(promiseStillHeld(0, 37_000, 37_000 + PROMISE_GRACE_MS)).toBe(false);
    });

    it('gives a break of unknown length a fixed allowance', () => {
        expect(promiseStillHeld(0, undefined, PROMISE_UNKNOWN_LENGTH_MS + PROMISE_GRACE_MS - 1)).toBe(true);
        expect(promiseStillHeld(0, undefined, PROMISE_UNKNOWN_LENGTH_MS + PROMISE_GRACE_MS)).toBe(false);
    });
});
