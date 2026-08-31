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
    const isPort = (element: HTMLElement): boolean => element.getAttribute('aria-label') === 'Running order';
    const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;

    beforeAll(() => {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
            configurable: true,
            get(this: HTMLElement): number {
                return isPort(this) ? height : (realHeight.get!.call(this) as number);
            },
        });
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
            configurable: true,
            get(this: HTMLElement): number {
                return isPort(this) ? width : (realWidth.get!.call(this) as number);
            },
        });
    });

    afterAll(() => {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight);
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realWidth);
    });
}
