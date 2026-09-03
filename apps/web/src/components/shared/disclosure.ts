import { useId } from 'react';

/**
 * The ARIA plumbing a show/hide toggle owes the panel it opens.
 *
 * Three of these in the console set neither: a button whose label swaps between "Show what failed"
 * and "Hide what failed" (`attention.list.tsx`), and one whose label swaps between "Show technical
 * detail" and "Hide technical detail" (`route.error.tsx`). Both announce as a button with no
 * indication of what it does or whether it is open — `on.air.now.tsx`'s "Why is it on air?" button
 * and `track.expansion.tsx`'s `TrackExpandButton` already carry `aria-expanded`, and this is the
 * same fix pulled out once rather than written a third time.
 *
 * `id` is stable for the life of the component (`useId`, not generated per render), so it is safe
 * to hand to a panel that mounts only while open: the `aria-controls` reference is already correct
 * before the element it names exists.
 */
export interface DisclosureIds {
    /** Spread onto the trigger — an `Anchor` or `Button` acting as the toggle. */
    trigger: {
        'aria-expanded': boolean;
        'aria-controls': string;
    };
    /** Put on the panel's root, whatever wraps or gates its content (`Collapse`, or the content itself). */
    panelId: string;
}

export function useDisclosureIds(open: boolean): DisclosureIds {
    const id = useId();

    return {
        trigger: { 'aria-expanded': open, 'aria-controls': id },
        panelId: id,
    };
}
