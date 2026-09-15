/** How long an armed Stop stays armed before it forgets: the console's five seconds. */
export const ARMED_MS = 5_000;

export type Arm = { armed: false } | { armed: true; until: number };

export const DISARMED: Arm = { armed: false };

/**
 * A press on Stop.
 *
 * The first press arms it and the second, inside five seconds, fires. It is the console's arrangement
 * (`on.air.now.tsx`), and on a deck it matters more: Stop is the only key that takes the station off
 * air, it can sit beside Skip, and it is pressed without looking. A confirm dialog has nowhere to go
 * on a key, so the key says "Confirm" instead, and forgets on its own, because an armed Stop nobody
 * is looking at is a Stop that fires on the next stray press.
 */
export function press(arm: Arm, now: number): { arm: Arm; fire: boolean } {
    if (arm.armed && now < arm.until) return { arm: DISARMED, fire: true };
    return { arm: { armed: true, until: now + ARMED_MS }, fire: false };
}

/** The arm as it stands at `now`: forgotten once its five seconds are up. */
export function expire(arm: Arm, now: number): Arm {
    return arm.armed && now >= arm.until ? DISARMED : arm;
}
