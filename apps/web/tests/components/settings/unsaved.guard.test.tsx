// What is pinned here is the wiring, not TanStack's blocker: that a clean page does not install one
// at all, that the dialog is shown only while a navigation is actually held, and that the two
// buttons resolve it the opposite ways round. The last one is the whole point — the destructive
// half reads like carrying on, so a wire crossed here loses an operator's work silently.

import { describe, expect, it, vi } from 'vitest';

import { UnsavedGuard } from '../../../src/components/settings/unsaved.guard';
import { render, screen, setupUser } from '../../utils/render';

const proceed = vi.fn();
const reset = vi.fn();

let blocked = false;

const useBlocker = vi.fn((_options: unknown) => (blocked ? { status: 'blocked' as const, proceed, reset } : { status: 'idle' as const }));

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useBlocker: (options: unknown) => useBlocker(options),
}));

/** The options the guard asked for on its last render. */
const asked = () =>
    useBlocker.mock.calls.at(-1)?.[0] as unknown as { disabled: boolean; shouldBlockFn: () => boolean; enableBeforeUnload: () => boolean };

describe('UnsavedGuard', () => {
    it('installs no blocker at all while nothing is unsaved', () => {
        blocked = false;
        render(<UnsavedGuard dirty={false} />);

        // `disabled` rather than a `shouldBlockFn` returning false, so a clean page pays nothing.
        expect(asked().disabled).toBe(true);
        expect(asked().shouldBlockFn()).toBe(false);
        expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
    });

    it('blocks the router and the browser off the same bit', () => {
        blocked = false;
        render(<UnsavedGuard dirty />);

        expect(asked().disabled).toBe(false);
        expect(asked().shouldBlockFn()).toBe(true);
        // The half `useBlocker` cannot cover: closing the tab gets the browser's own dialog.
        expect(asked().enableBeforeUnload()).toBe(true);
    });

    it('asks only once a navigation is actually held', () => {
        blocked = false;
        const { rerender } = render(<UnsavedGuard dirty />);
        expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();

        blocked = true;
        rerender(<UnsavedGuard dirty />);

        expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    });

    it('stays put on Stay here, and lets the navigation go on Discard', async () => {
        blocked = true;
        render(<UnsavedGuard dirty />);
        const user = setupUser();

        await user.click(screen.getByRole('button', { name: 'Stay here' }));
        expect(reset).toHaveBeenCalledTimes(1);
        expect(proceed).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Discard and leave' }));
        expect(proceed).toHaveBeenCalledTimes(1);
    });

    it('treats a dismissed dialog as staying put, never as discarding', async () => {
        // Escape and the close button both mean "I did not mean to leave". Resolving them as
        // `proceed` would throw the edit away on the one gesture that is nearly always a reflex.
        blocked = true;
        reset.mockClear();
        proceed.mockClear();
        render(<UnsavedGuard dirty />);

        await setupUser().keyboard('{Escape}');

        expect(reset).toHaveBeenCalled();
        expect(proceed).not.toHaveBeenCalled();
    });
});
