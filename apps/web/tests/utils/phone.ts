/**
 * Puts the window below the `sm` breakpoint for the duration of a test, and hands back the desk.
 *
 * `tests/setup.ts` stubs `matchMedia` to answer `matches: false` globally, which is why every page
 * test exercises the desktop branch without saying so. A case that wants the card branch calls this
 * and restores in `afterEach` — restoring matters, because the stub is a window property shared by
 * every case in the file, not a render-scoped fact.
 *
 * Only a `max-width` query answers true: `usePhone` asks one, and answering yes to everything would
 * also flip `prefers-reduced-motion` and every `visibleFrom`, which is not what a phone is.
 */
export function stubPhoneMedia(): () => void {
    const desk = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        // Plain, for `tests/setup.ts`'s reason: a `vi.fn()` here is stripped of its implementation
        // by the `vi.resetAllMocks()` a dozen files in this suite run between cases, and answers
        // `undefined` for the rest of the file.
        value: (query: string) => ({
            matches: query.includes('max-width'),
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }),
    });
    return () => {
        Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: desk });
    };
}
