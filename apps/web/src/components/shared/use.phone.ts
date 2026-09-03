import { useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

/**
 * Whether the console is being read on a phone — below the `sm` breakpoint, the same line the shell
 * collapses its navbar on and swaps the rail for the bottom bar.
 *
 * One hook rather than a media query written where it is needed, because the query had already been
 * hand-rolled twice (`__root.tsx` and `station.order.table.tsx`) and a third copy is where the two
 * halves of the shell start disagreeing about where a phone ends.
 *
 * ## It answers on the FIRST render, and that is not the default
 *
 * Mantine's `getInitialValueInEffect` defaults to `true`: the hook returns the fallback on the first
 * render and corrects itself in an effect. That is right for a page that is server-rendered, where
 * there is no window to ask and a mismatch is a hydration error. This console is `createRoot` and
 * has never been anything else, so the window is there to be asked and the deferral buys nothing.
 *
 * What it cost was a routing decision. `/settings` redirects to the first section on a desk and IS
 * the list of sections on a phone, and it made that choice while this still said "desktop" — so a
 * phone was redirected off the list before the effect could correct anything, and the settings
 * sections were unreachable on a phone entirely. The way back was the same race, so it bounced
 * straight off again.
 *
 * The fallback stays for the case it was written for: a window with no `matchMedia` at all answers
 * `false`, which is a desk. What changed is that a window WITH one is asked before anything renders.
 */
export function usePhone(): boolean {
    const theme = useMantineTheme();
    return useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, false, { getInitialValueInEffect: false }) ?? false;
}
