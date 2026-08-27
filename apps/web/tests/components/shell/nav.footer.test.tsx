import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NavFooter } from '../../../src/components/shell/nav.footer';
import { render, screen, setupUser } from '../../utils/render';

// The footer is exercised without a router: only `Link` is reached, and only to render an anchor.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...props }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

describe('NavFooter', () => {
    it('holds the two places an operator arrives at rather than goes to', () => {
        render(<NavFooter />);

        expect(screen.getByRole('link', { name: 'Check-up' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
        expect(screen.getAllByRole('link')).toHaveLength(2);
    });

    /**
     * Neither carries a key hint, and that is the rule rather than an omission: a shortcut is for a
     * place you go on purpose, and nobody opens the console to look at Settings.
     */
    it('offers no shortcut to either', () => {
        render(<NavFooter />);

        for (const letter of ['C', 'S']) {
            expect(screen.queryByText(letter)).not.toBeInTheDocument();
        }
    });

    it('badges Settings for a plugin that will not start, because that is where plugins live', () => {
        render(
            <NavFooter attention={[{ code: 'plugin.failed', severity: 'failure', title: 'a', detail: 'a', route: '/plugins/deadair.spotify' }]} />,
        );

        expect(screen.getByRole('link', { name: 'Settings, 1 thing needs attention' })).toBeInTheDocument();
    });

    it('draws no way out when there is no session to end', () => {
        // The login page renders no shell at all, but the prop is what decides this rather than the
        // caller remembering to leave the button off.
        render(<NavFooter />);

        expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
    });

    it('signs out when asked', async () => {
        const onLogout = vi.fn();
        render(<NavFooter onLogout={onLogout} />);

        await setupUser().click(screen.getByRole('button', { name: 'Logout' }));

        expect(onLogout).toHaveBeenCalled();
    });
});
