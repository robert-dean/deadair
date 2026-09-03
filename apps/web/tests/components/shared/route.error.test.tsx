import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { RouteError } from '../../../src/components/shared/route.error';
import { render, screen, setupUser } from '../../utils/render';

const invalidate = vi.fn();

// The suite's convention for a component that links: the real router needs a route tree this test
// has no use for, so `Link` becomes an anchor and `useRouter` returns only what is called on it.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
    useRouter: () => ({ invalidate }),
}));

afterEach(() => {
    invalidate.mockReset();
});

/** The props TanStack hands an error component. `info` is unused here and typed as such. */
function props(error: Error, reset = vi.fn()) {
    return { error, reset, info: undefined, isRoot: false } as never;
}

describe('RouteError', () => {
    it('blames the page for a failure the page caused, and repeats what the server said', () => {
        const error = new SdkError(500, 'Server Error', { message: 'the lineup could not be read' }, new Headers());
        render(<RouteError {...props(error as unknown as Error)} />);

        expect(screen.getByText(/this page did not load/i)).toBeInTheDocument();
        // The server's own sentence, not the status phrase: `apiErrorMessage` exists to stop a
        // considered explanation being flattened to the word "Error".
        expect(screen.getByText(/the lineup could not be read/i)).toBeInTheDocument();
    });

    it('stops blaming the page when the whole origin is unreachable', () => {
        // The banner is already counting down; this panel's job is only to not send the operator
        // looking for a bug in one route over something the whole console is experiencing.
        render(<RouteError {...props(new TypeError('Failed to fetch'))} />);

        expect(screen.getByText(/the station is not answering/i)).toBeInTheDocument();
        expect(screen.getByText(/already trying again/i)).toBeInTheDocument();
    });

    it('clears the boundary AND re-runs the loader, because either alone is a no-op', async () => {
        const reset = vi.fn();
        const user = setupUser();
        render(<RouteError {...props(new Error('boom'), reset)} />);

        await user.click(screen.getByRole('button', { name: /try again/i }));

        // Resetting alone re-renders straight back into the same failure; invalidating alone
        // leaves the boundary up. The pair is the fix, so the test asserts the pair.
        expect(reset).toHaveBeenCalledOnce();
        expect(invalidate).toHaveBeenCalledOnce();
    });

    it('keeps the stack out of the way until it is asked for, and always offers it', async () => {
        const user = setupUser();
        const error = new Error('boom');
        error.stack = 'Error: boom\n    at somewhere.ts:1:1';
        render(<RouteError {...props(error)} />);

        const toggle = screen.getByRole('button', { name: /show technical detail/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        const panelId = toggle.getAttribute('aria-controls');
        expect(panelId).toBeTruthy();

        await user.click(toggle);

        expect(screen.getByText(/at somewhere\.ts:1:1/)).toBeVisible();
        const hideToggle = screen.getByRole('button', { name: /hide technical detail/i });
        expect(hideToggle).toHaveAttribute('aria-expanded', 'true');
        expect(hideToggle).toHaveAttribute('aria-controls', panelId);
        expect(document.getElementById(panelId as string)).toBeInTheDocument();
    });
});
