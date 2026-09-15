import { describe, expect, it } from 'vitest';

import { ARMED_MS, DISARMED, expire, press } from '../../src/actions/arming.js';

describe('press', () => {
    it('arms on the first press and fires on the second inside five seconds', () => {
        const first = press(DISARMED, 1_000);
        expect(first).toEqual({ arm: { armed: true, until: 1_000 + ARMED_MS }, fire: false });
        expect(press(first.arm, 1_000 + ARMED_MS - 1)).toEqual({ arm: DISARMED, fire: true });
    });

    it('only arms again once the five seconds are up', () => {
        const first = press(DISARMED, 1_000);
        expect(press(first.arm, 1_000 + ARMED_MS)).toEqual({ arm: { armed: true, until: 1_000 + 2 * ARMED_MS }, fire: false });
    });
});

describe('expire', () => {
    it('forgets an arm at five seconds and not before', () => {
        const { arm } = press(DISARMED, 0);
        expect(expire(arm, ARMED_MS - 1)).toBe(arm);
        expect(expire(arm, ARMED_MS)).toEqual(DISARMED);
        expect(expire(DISARMED, 0)).toEqual(DISARMED);
    });
});
