import { useEffect, useState } from 'react';

/**
 * How far down the viewport a section has to reach before it counts as the one being read.
 *
 * The same 76 every section anchor already uses as its `scrollMarginTop`: that is the sticky
 * header's height plus the gap it leaves, so it is the y where page content actually begins. Using
 * the same number twice is what makes a jump land on the heading it lit up — one of them being the
 * anchor's clearance and the other the spy's threshold is a coincidence worth keeping deliberate.
 */
const HEADER_OFFSET = 76;

/**
 * Which of `ids` the operator is currently looking at.
 *
 * The DOM is re-read on every measurement rather than resolved once and cached, and that is the
 * whole reason this exists instead of Mantine's `useScrollSpy`. That hook collects its targets when
 * it mounts and exposes a `reinitialize()` for when they change — but this page's sections do not
 * exist at mount at all. `SettingsPage` draws a skeleton until `useSettings()` resolves, and the
 * nav that wants the highlight is a SIBLING of the page, so it has no idea when the cards arrived.
 * Reading `getElementById` per measurement removes the question: sections that are not there yet
 * simply do not match, and they start matching the moment they render.
 *
 * The rule is "the last section whose top has passed the header", which is what reading feels like:
 * a section stays lit while its body is on screen, rather than the highlight jumping to whichever
 * heading happens to be nearest the middle.
 */
export function useActiveSection(ids: readonly string[]): string | undefined {
    const [active, setActive] = useState<string | undefined>(undefined);

    useEffect(() => {
        // Coalesced into a frame: scroll fires far more often than the paint that would show the
        // result, and each run touches the layout of every section.
        let frame = 0;

        const measure = () => {
            frame = 0;

            const present = ids.filter(id => document.getElementById(id) !== null);

            // At the bottom of the document, no further scrolling can bring the last sections up to
            // the header, so the plain rule below would leave the highlight stuck several sections
            // short for the whole of the final screenful. Whatever is last and rendered is what is
            // being looked at down here. The 2px is for a viewport height that lands fractional
            // under a browser zoom, where the sum never quite reaches the scroll height.
            const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
            if (atBottom && present.length > 0) {
                setActive(present[present.length - 1]);
                return;
            }

            let current: string | undefined = undefined;
            for (const id of present) {
                const top = document.getElementById(id)!.getBoundingClientRect().top;
                // Rounded down before comparing. Every section anchor carries `scrollMarginTop:
                // 76`, so following one of these links parks its top at exactly the threshold — and
                // a fractional device pixel there put it at 76.5, which failed the test and lit the
                // section ABOVE the one just jumped to. A link that highlights its neighbour is
                // worse than one that highlights nothing.
                if (Math.floor(top) <= HEADER_OFFSET) {
                    current = id;
                }
            }
            // The first section wins before the page has been scrolled at all: nothing has passed
            // the header yet, and an unlit list at the top of a page reads as broken rather than as
            // "you are above the first section".
            setActive(current ?? present[0] ?? ids[0]);
        };

        const schedule = () => {
            if (frame === 0) {
                frame = window.requestAnimationFrame(measure);
            }
        };

        measure();
        window.addEventListener('scroll', schedule, { passive: true });
        // Sections move when the window changes width, and on this page they also move when a card
        // finishes loading — which is a resize of the document rather than of the window, so the
        // scroll listener alone would leave the highlight stale until the next scroll.
        window.addEventListener('resize', schedule);

        return () => {
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            if (frame !== 0) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, [ids]);

    return active;
}
