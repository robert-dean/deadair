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
            // One link, not two: the desk answers what Home and On air answered separately.
            'Desk',
            'Schedule',
            'Activity',
            'Catalog',
            'Playlists',
            'Charts',
            'News',
            // Eight links became one destination with tabs. The tabs themselves are covered in
            // `voice.page.test.tsx`; what belongs here is that the nav offers the way in.
            'Voice',
            'Plugins',
            'Check-up',
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

    it('says what a badge means in words, rather than sticking its number on the name', () => {
        // Mantine folds a `rightSection` into the link's accessible name, so an unguarded badge
        // renames "Catalog" to "Catalog 4" for a screen reader. The badge stays hidden and the link
        // carries the sentence instead, so the shortcut exists for somebody not looking at it.
        render(<SideNav attention={[{ code: 'benchedCopies', severity: 'warning', title: 'a', detail: 'a', route: '/catalog' }]} />);

        expect(screen.getByRole('link', { name: 'Catalog, 1 thing needs attention' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Catalog 1' })).not.toBeInTheDocument();
    });

    it('counts in the plural when there is more than one', () => {
        render(
            <SideNav
                attention={[
                    { code: 'benchedCopies', severity: 'warning', title: 'a', detail: 'a', route: '/catalog' },
                    { code: 'failingFetches', severity: 'failure', title: 'b', detail: 'b', route: '/catalog' },
                ]}
            />,
        );

        expect(screen.getByRole('link', { name: 'Catalog, 2 things need attention' })).toBeInTheDocument();
    });

    /** A link with nothing waiting keeps its plain name rather than announcing that nothing is wrong. */
    it('leaves a link with nothing waiting exactly as it was', () => {
        render(<SideNav />);

        expect(screen.getByRole('link', { name: 'Catalog' })).toBeInTheDocument();
    });

    it('tells the shell to shut the drawer once a link is followed', async () => {
        const onNavigate = vi.fn();
        render(<SideNav onNavigate={onNavigate} />);

        await setupUser().click(screen.getByRole('link', { name: 'Catalog' }));

        expect(onNavigate).toHaveBeenCalled();
    });
});
