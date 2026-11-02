import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';

/** How near the pinned position counts as being back at it, in px. */
const RE_ARM_SLACK = 12;

/** Longest a pin of this hook's own is allowed to still be settling, in ms. */
const PIN_SETTLE_MS = 800;

/**
 * Holds the row that is going out at the top of the table, and lets go when the operator scrolls.
 *
 * The whole point of this page is the item that is on now, and a long order buries it: an hour of
 * played records pushes it off the screen, and every boundary pushes it one row further. So the
 * table scrolls itself so that row sits under the header, and the history stays above it where it
 * can still be read.
 *
 * **It stops following the moment the operator scrolls.** A console that dragged the view back
 * while somebody was reading the tail would be worse than one that never moved. The release is
 * taken from the SCROLL rather than from a wheel, because a dragged scrollbar fires no wheel event
 * and reading the tail with the mouse is exactly how somebody would do it; the cost is that this
 * hook's own scrolling has to be told apart from a person's, which is what `pinning` is for. It
 * re-arms when the anchor is back at the top, whoever put it there.
 */
export function usePinnedToAir(
    anchorId: string | undefined,
    anchorIndex: number | undefined,
    itemCount: number,
    virtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement>,
    portRef: RefObject<HTMLDivElement | null>,
) {
    const [following, setFollowing] = useState(true);
    // The first pin is the page arriving at a running order already in progress, which should not
    // read as an animation of something that just happened.
    const settled = useRef(false);

    /**
     * Where the port would have to be scrolled for the anchor row to sit under the header.
     *
     * Arithmetic over the virtualizer's offsets rather than a measurement of the row, because with
     * the table windowed the anchor row need not be mounted at all — which is exactly the state the
     * re-arm below has to reason about, an operator away in the tail with the anchor scrolled out.
     *
     * The thead never appears in this sum, and that is a cancellation rather than an omission: the
     * virtualizer's offsets start at the top of the tbody, which sits one thead below the top of the
     * scroll content, and the pin target is the anchor one thead below the top of the viewport. The
     * two theads cancel, so the anchor's own offset IS the scroll position — the same reason the
     * virtualizer needs no `scrollMargin`, since the rows its window is off by are exactly the rows
     * hidden under the sticky header, and overscan covers the difference besides.
     */
    const pinnedTop = useCallback((): number | undefined => {
        if (anchorIndex === undefined) return undefined;
        const offset = virtualizer.getOffsetForIndex(anchorIndex, 'start');
        return offset === undefined ? undefined : Math.max(0, offset[0]);
    }, [anchorIndex, virtualizer]);

    // Whether the scroll now under way is this hook's own. A smooth scroll arrives as a run of
    // scroll events at positions that are not the pinned one, and without this every one of them
    // would read as the operator scrolling away. The timer is the backstop rather than the
    // mechanism: an animation that is interrupted never reaches its target and would otherwise
    // leave this stuck on, and a hook stuck on is a table that can never be scrolled off air.
    const pinning = useRef<number | undefined>(undefined);
    const holdPinning = useCallback(() => {
        window.clearTimeout(pinning.current);
        pinning.current = window.setTimeout(() => {
            pinning.current = undefined;
        }, PIN_SETTLE_MS);
    }, []);

    const pin = useCallback(
        (behavior: ScrollBehavior) => {
            const top = pinnedTop();
            if (top === undefined) return;
            holdPinning();
            // A smooth scroll is an animation, and a browser runs no animation frames for a tab
            // nobody is looking at: asking for one there moves nothing at all. A console left open
            // on another tab is the ordinary case here, so the jump is taken instead — there is
            // nobody to see it, which is the same reason the animation was wanted.
            portRef.current?.scrollTo({ top, behavior: behavior === 'smooth' && !document.hidden ? 'smooth' : 'auto' });
            setFollowing(true);
        },
        [pinnedTop, holdPinning, portRef],
    );

    useEffect(
        () => () => {
            window.clearTimeout(pinning.current);
        },
        [],
    );

    // `itemCount` as well as the anchor: a refill lands, a cut splices, and the row keeps its id
    // while everything under it moves.
    useEffect(() => {
        if (!following || anchorId === undefined) return;
        pin(settled.current ? 'smooth' : 'auto');
        settled.current = true;
    }, [anchorId, itemCount, following, pin]);

    // A pin is arithmetic over the CURRENT heights of everything above the anchor, and those keep
    // moving after the effect above has run: every row above carries a sleeve that arrives from the
    // network, and a row is shorter until its image lands. Measured on this station, that left the
    // anchor a row low. The old shape watched the table with a ResizeObserver; with the rows
    // windowed the virtualizer is already the thing doing the measuring, so its total size is the
    // one number that moves whenever any mounted row changes height — the artwork, a wrapped title
    // on a narrow window and the window being resized, all as one fact. It is also the
    // self-correction for the windowing itself: a pin lands on estimated offsets, the rows around
    // the landing point mount and measure, the total shifts, and the pin is retaken exactly.
    // `following` is mirrored into a ref so a pin that just SET it does not immediately re-run this
    // effect and turn its own smooth scroll into a jump.
    const totalSize = virtualizer.getTotalSize();
    const followingNow = useRef(following);
    useEffect(() => {
        followingNow.current = following;
    }, [following]);
    useEffect(() => {
        if (!followingNow.current) return;
        // A jump while parked is invisible; a jump while one of this hook's own smooth scrolls is
        // in flight is not, and rows measuring as the animation passes them is the ordinary way
        // this fires mid-flight. Retargeting the animation keeps it an animation.
        pin(pinning.current === undefined ? 'auto' : 'smooth');
    }, [totalSize, pin]);

    return {
        /** Offered as a control only when there is something to go back TO. */
        pinnable: anchorId !== undefined && !following,
        pin,
        handlers: {
            onScroll: () => {
                const top = pinnedTop();
                if (top === undefined) return;
                if (Math.abs((portRef.current?.scrollTop ?? 0) - top) <= RE_ARM_SLACK) {
                    // Landed. Whoever was scrolling, the anchor is where it belongs.
                    window.clearTimeout(pinning.current);
                    pinning.current = undefined;
                    setFollowing(true);
                } else if (pinning.current === undefined) {
                    setFollowing(false);
                }
            },
        },
    };
}
