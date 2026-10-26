import { useCallback, useEffect, useRef, useState } from 'react';

/** How long an armed control stays armed before it forgets, in ms. */
export const ARMED_MS = 5_000;

/**
 * A control held one press away from firing: the first press arms it, the second fires it.
 *
 * For the controls whose press every listener hears and that cannot be taken back: Stop, which takes
 * the station off air and sits ten pixels from Skip, and Hand back, which cuts a presenter off. A
 * confirm dialog is the ordinary answer and is the wrong one here: this surface is used with a thumb
 * from bed as often as with a mouse, and a modal over a 44px control is a second target to find
 * rather than a moment to think.
 *
 * So the button arms itself instead, and says so by changing what it is called. It disarms on its
 * own, because a control left armed on a console nobody is looking at is one that fires on the next
 * stray press, which is the thing this exists to prevent, arriving a minute later.
 */
export function useArmedPress(fire: () => void, armedMs = ARMED_MS) {
    const [armed, setArmed] = useState(false);
    const timer = useRef<number | undefined>(undefined);

    const disarm = useCallback(() => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        setArmed(false);
    }, []);

    useEffect(
        () => () => {
            window.clearTimeout(timer.current);
        },
        [],
    );

    return {
        armed,
        press: () => {
            if (armed) {
                disarm();
                fire();
                return;
            }
            setArmed(true);
            timer.current = window.setTimeout(disarm, armedMs);
        },
    };
}
