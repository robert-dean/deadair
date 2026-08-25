import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SideNav } from '../../../src/components/shell/side.nav';
import { render, screen, setupUser } from '../../utils/render';

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
            'Subjects',
            'Productions',
            'Voices',
            'Pronunciations',
            'Scripts',
            'Plugins',
            'Settings',
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

    it('counts what needs somebody against the page that can act on it', () => {
        // A row pointing at one plugin's own page counts against Plugins, because the first segment
        // is the page. Two rows on the catalog is one badge saying 2.
        render(
            <SideNav
                attention={[
                    { code: 'benchedCopies', severity: 'warning', title: 'a', detail: 'a', route: '/catalog' },
                    { code: 'failingFetches', severity: 'warning', title: 'b', detail: 'b', route: '/catalog' },
                    { code: 'plugin.failed', severity: 'warning', title: 'c', detail: 'c', route: '/plugins/deadair.spotify' },
                ]}
            />,
        );

        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('leaves the accessible name of a link alone when it carries a badge', () => {
        // Mantine folds a `rightSection` into the link's accessible name, so an unguarded badge
        // renames "Catalog" to "Catalog 4" for a screen reader. The number is a visual shortcut and
        // the sentence behind it is on the page this links to.
        render(<SideNav attention={[{ code: 'benchedCopies', severity: 'warning', title: 'a', detail: 'a', route: '/catalog' }]} />);

        expect(screen.getByRole('link', { name: 'Catalog' })).toBeInTheDocument();
    });

    it('tells the shell to shut the drawer once a link is followed', async () => {
        const onNavigate = vi.fn();
        render(<SideNav onNavigate={onNavigate} />);

        await setupUser().click(screen.getByRole('link', { name: 'Catalog' }));

        expect(onNavigate).toHaveBeenCalled();
    });
});
