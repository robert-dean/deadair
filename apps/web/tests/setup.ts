import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

import '@testing-library/jest-dom/vitest';

// Testing Library only self-registers cleanup when vitest runs with `globals: true`,
// which this package does not, so renders would otherwise pile up in one document.
afterEach(cleanup);

// How long `findBy*` and `waitFor` keep retrying.
//
// Testing Library's own clock, and NOT the one `testTimeout` in vitest.config.ts sets — which is
// why raising that alone did not make this suite reliable. The default is one second, so under a
// full workspace run, where every package's tests are competing for the same cores, a query that
// resolves in 20ms standalone can miss it. The failure that produces is the worst-reading kind: an
// assertion saying an element is not in the document, about a page that renders it perfectly well.
//
// Retries are cheap and only the failing path pays the ceiling, so this is generous on purpose.
configure({ asyncUtilTimeout: 10_000 });

// jsdom implements neither of these, and Mantine components use both.
//
// A PLAIN function rather than a `vi.fn()`, which it was until this bit. Nothing asserts on how
// `matchMedia` was called, so it never needed to be a spy — and being one made it fragile in a way
// nothing pointed at: a dozen files in this suite call `vi.resetAllMocks()` between cases, which
// strips a mock's implementation and leaves it answering `undefined`. Every page that asks whether
// it is on a phone was then reading `.matches` off nothing.
//
// It went unnoticed because Mantine's `useMediaQuery` asked in an effect, inside a `try`, so the
// throw was swallowed and the answer stayed at the fallback — which happened to be the right one.
// `usePhone` now asks during render, where a routing decision can read it, and there is no `try`
// around that. A stub that a mock reset cannot break is the fix; a `try/catch` in app code to
// survive the test environment would not be.
//
// `configurable` so a test can put its own answer here and take it away again. See
// `tests/utils/phone.ts`.
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }),
});

// `window.localStorage` is undefined here, not merely empty: Node's own experimental
// localStorage global takes the name and then refuses to work without
// --localstorage-file, so jsdom's implementation never reaches the window. Anything
// that remembers a preference (the transport's open state, the monitor's level) would
// otherwise be untestable, and Mantine's useLocalStorage would warn on every render.
class MemoryStorage implements Storage {
    private entries = new Map<string, string>();

    get length(): number {
        return this.entries.size;
    }
    key(index: number): string | null {
        return [...this.entries.keys()][index] ?? null;
    }
    getItem(key: string): string | null {
        return this.entries.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.entries.set(key, String(value));
    }
    removeItem(key: string): void {
        this.entries.delete(key);
    }
    clear(): void {
        this.entries.clear();
    }
}

Object.defineProperty(window, 'localStorage', { writable: true, value: new MemoryStorage() });

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}

window.ResizeObserver = ResizeObserverStub;

// jsdom implements no scrolling whatsoever, and `Element.prototype.scrollTo` is absent rather than
// inert: a component that holds its own scroll position — the running order, which keeps the item
// on air under the table's header — throws on mount here instead of failing an assertion. Stubbed
// on the same argument as the two above, since the alternative is a layout decision made by the
// test runner. Nothing asserts on scrolling; there is nothing laid out to scroll.
Element.prototype.scrollTo = () => {};

// The same absence one line up, reached by a different component. Mantine's `Combobox` keeps the
// highlighted option in view, on a timer that outlives the test that opened the dropdown — so the
// throw lands as an unhandled error AFTER the case has passed, which vitest reports as a run-level
// failure attached to whichever file happened to be running. Every `Select` in this console is one
// of these, so it belongs here rather than in the first test that met it.
Element.prototype.scrollIntoView = () => {};

// jsdom has no font loading API, and Mantine's autosizing textarea waits on one: it measures a box
// again once the fonts have settled, which is a real thing to do in a browser and a `TypeError` on
// mount here. Stubbed rather than avoided, because otherwise the rule becomes "do not use `autosize`
// in anything you want to test", which is a layout decision made by the test runner.
Object.defineProperty(document, 'fonts', {
    writable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn(), ready: Promise.resolve(), status: 'loaded' },
});
