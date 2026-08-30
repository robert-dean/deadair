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
 * The `false` fallback is load-bearing and is the desktop: while the browser has not answered yet
 * (first paint), a page laid out for a desk and corrected is cheaper than a phone layout flashing on
 * every desktop load — and on an actual phone the reverse costs one frame of the nav being
 * somewhere else, where the desktop cost would be 64px of empty bar on a desk.
 */
export function usePhone(): boolean {
    const theme = useMantineTheme();
    return useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, false) ?? false;
}
