import { afterAll, beforeAll } from 'vitest';

/**
 * Gives the running order's scroll port a measured height, which jsdom never would.
 *
 * The order's table mounts a WINDOW of rows sized from the port's rect — read off `offsetWidth` and
 * `offsetHeight`, which is why this shims those and not `getBoundingClientRect` — and the
 * virtualizer treats a height of zero as a window of zero rows. So under jsdom, which lays nothing
 * out and measures every element at zero, the whole tbody would be empty and every assertion about
 * a row would fail against a table that renders perfectly well in a browser.
 *
 * A file that renders the running order calls this once at the top. It is deliberately not in
 * `tests/setup.ts`: the shims there are jsdom-wide absences, and this is one component's element
 * answering with one made-up rect. Only the port is touched — the rows still measure zero, which
 * the table itself covers by falling back to its own row estimate.
 *
 * The height is generous rather than the port's real 320px floor so that a fixture of a couple of
 * dozen rows mounts whole and existing suites can keep asserting on "every row"; a test about
 * windowing itself (rows NOT mounted) should size its fixture well past height / estimate plus
 * overscan — see the constants in `station.order.table.tsx`.
 */
export function measureTheOrderPort(height = 600, width = 780): void {
    // A prefix match rather than equality: the label grew a second sentence (arrow-key roving
    // within a row) after this helper was written, and re-deriving the whole string here every
    // time the label's wording changes is exactly the kind of coupling a prefix check avoids.
    const isPort = (element: Element): boolean => (element.getAttribute('aria-label') ?? '').startsWith('Running order');

    // `scrollHeight` as well, because the virtualizer clamps every computed offset to
    // `scrollHeight - clientHeight` — the port's real scroll limit in a browser, and zero minus
    // zero under jsdom, which silently clamps every pin target to the top of the table. Answered
    // as a mile of content rather than derived from any real fixture, so no clamp ever engages;
    // nothing in the tests scrolls to the genuine bottom.
    const shims: Array<[object, string, () => number]> = [
        [HTMLElement.prototype, 'offsetHeight', () => height],
        [HTMLElement.prototype, 'offsetWidth', () => width],
        [Element.prototype, 'clientHeight', () => height],
        [Element.prototype, 'scrollHeight', () => 1_000_000],
    ];
    const real = shims.map(([proto, name]) => Object.getOwnPropertyDescriptor(proto, name)!);

    beforeAll(() => {
        for (const [proto, name, answer] of shims) {
            const inherited = Object.getOwnPropertyDescriptor(proto, name)!;
            Object.defineProperty(proto, name, {
                configurable: true,
                get(this: Element): number {
                    return isPort(this) ? answer() : (inherited.get!.call(this) as number);
                },
            });
        }
    });

    afterAll(() => {
        shims.forEach(([proto, name], index) => {
            Object.defineProperty(proto, name, real[index]!);
        });
    });
}
