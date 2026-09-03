// The hook answers a layout question everywhere and a ROUTING question in one place, and those have
// different tolerances. A layout that starts wrong and corrects itself costs a frame. A redirect
// that starts wrong has already happened: `/settings` sends a desk to the first section and IS the
// list of sections on a phone, so a first render that says "desk" on a phone navigated off the list
// before anything could correct it, and the settings sections were unreachable on a phone entirely —
// the way back raced the same way and bounced straight off again.
//
// So what is pinned here is the FIRST value, which is the one no other test can see: every case in
// this suite that waits for an assertion is already past the effect that corrects it.

import { afterEach, describe, expect, it } from 'vitest';

import { usePhone } from '../../../src/components/shared/use.phone';
import { render, screen } from '../../utils/render';
import { stubPhoneMedia } from '../../utils/phone';

let restore: (() => void) | undefined;

afterEach(() => {
    restore?.();
    restore = undefined;
});

/** Records what the hook said on every render, so the first one can be read back. */
function Probe({ seen }: { seen: boolean[] }) {
    const phone = usePhone();
    seen.push(phone);
    return <span data-testid="answer">{String(phone)}</span>;
}

describe('usePhone', () => {
    it('says desk on a desk, from the first render', () => {
        const seen: boolean[] = [];
        render(<Probe seen={seen} />);

        expect(seen[0]).toBe(false);
        expect(screen.getByTestId('answer')).toHaveTextContent('false');
    });

    it('says phone on a phone, from the first render rather than one effect later', () => {
        // Mantine defers to an effect by default, which is right for a server-rendered page and
        // wrong here: this console is `createRoot` and the window is there to be asked.
        restore = stubPhoneMedia();
        const seen: boolean[] = [];

        render(<Probe seen={seen} />);

        expect(seen[0]).toBe(true);
        expect(screen.getByTestId('answer')).toHaveTextContent('true');
    });

    it('answers desk when the window cannot be asked at all', () => {
        // The fallback's original job, and the only one left for it: a window with no `matchMedia`
        // is not a phone as far as anything here is concerned.
        //
        // DELETED rather than set to `undefined`, and the difference is not pedantry — Mantine
        // guards this with `'matchMedia' in window`, which a property set to `undefined` satisfies,
        // so the stub would be called and would throw during render. Reading the query up front
        // rather than in an effect means that throw has no `try` around it any more.
        const real = window.matchMedia;
        delete (window as { matchMedia?: typeof real }).matchMedia;
        // `configurable` as well as `writable`, matching how `tests/setup.ts` put it there in the
        // first place: a property redefined without it is non-configurable for the rest of the
        // worker, and jsdom's teardown ends the run by DELETING this one. That threw a teardown
        // error after every test in the file had already passed.
        restore = () => Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: real });

        const seen: boolean[] = [];
        render(<Probe seen={seen} />);

        expect(seen[0]).toBe(false);
    });
});
