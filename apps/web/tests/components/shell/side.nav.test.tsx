import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { SideNav } from '../../../src/components/shell/side.nav';
import { render, screen } from '../../utils/render';

// The nav is exercised without a router: only `Link` is reached, and only to render an anchor.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...props }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

describe('SideNav', () => {
    it('groups the destinations under the four headings', () => {
        render(<SideNav />);

        for (const group of ['Air', 'Library', 'Station', 'System']) {
            expect(screen.getByText(group)).toBeInTheDocument();
        }
    });

    it('offers every page the console has', () => {
        render(<SideNav />);

        const labels = [
            'Home',
            'On air',
            'Schedule',
            'Activity',
            'Catalog',
            'Playlists',
            'Personas',
            'Productions',
            'Voices',
            'Scripts',
            'Plugins',
            'Settings',
            'About',
        ];
        for (const label of labels) {
            expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
        }
        expect(screen.getAllByRole('link')).toHaveLength(labels.length);
    });

    /**
     * The header carried a Lineups link to a route that never existed, because Mantine's
     * polymorphic `component={Link}` erased the router's typing. `NavItem.to` is typed against the
     * router now, so the real guard is `tsc` — this only pins the removal so nobody puts it back
     * by hand.
     */
    it('does not offer the route that never existed', () => {
        render(<SideNav />);

        expect(screen.queryByRole('link', { name: 'Lineups' })).not.toBeInTheDocument();
    });

    it('tells the shell to shut the drawer once a link is followed', async () => {
        const onNavigate = vi.fn();
        render(<SideNav onNavigate={onNavigate} />);

        await userEvent.setup().click(screen.getByRole('link', { name: 'Catalog' }));

        expect(onNavigate).toHaveBeenCalled();
    });
});
