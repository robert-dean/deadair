import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import '@testing-library/jest-dom/vitest';

// Testing Library only self-registers cleanup when vitest runs with `globals: true`,
// which this package does not, so renders would otherwise pile up in one document.
afterEach(cleanup);

// jsdom implements neither of these, and Mantine components use both.
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
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

// jsdom has no font loading API, and Mantine's autosizing textarea waits on one: it measures a box
// again once the fonts have settled, which is a real thing to do in a browser and a `TypeError` on
// mount here. Stubbed rather than avoided, because otherwise the rule becomes "do not use `autosize`
// in anything you want to test", which is a layout decision made by the test runner.
Object.defineProperty(document, 'fonts', {
    writable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn(), ready: Promise.resolve(), status: 'loaded' },
});
