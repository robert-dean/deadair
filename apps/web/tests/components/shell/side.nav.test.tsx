import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SideNav } from '../../../src/components/shell/side.nav';
import { render, screen } from '../../utils/render';

// Where the nav thinks the operator is. The rail draws a destination's sections only while they are
// inside it, so almost every case here wants to be somewhere that expands nothing.
let pathname = '/nowhere';

// The nav is exercised without a router: `Link` is reached to render an anchor, and `useRouterState`
// to answer where we are.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...props }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
    useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) => select({ location: { pathname } }),
}));

beforeEach(() => {
    pathname = '/nowhere';
});

describe('SideNav', () => {
    it('has no headings, because a heading over one destination is a heading arguing with itself', () => {
        // The groups were the right answer to nineteen links, and stopped being one when the pages
        // behind them folded into destinations. The sections below are LINKS under a link, which is
        // the thing the old grouping was not.
        render(<SideNav />);

        for (const group of ['Air', 'Station', 'System']) {
            expect(screen.queryByText(group)).not.toBeInTheDocument();
        }
    });

    it('offers the four destinations, and only those, from anywhere else', () => {
        render(<SideNav />);

        const labels = [
            // One link, not two: the desk answers what Home and On air answered separately.
            'Desk',
            'Programme',
            'Library',
            // Eight links became one destination with tabs. The tabs themselves are covered in
            // `voice.page.test.tsx`; what belongs here is that the nav offers the way in.
            'Voice',
        ];
        for (const label of labels) {
            expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
        }
        // Check-up and Settings are in `nav.footer.tsx`, pinned under a rule at the bottom of the
        // rail. Nobody opens the console to look at either; they arrive from something that sent
        // them, and a list that mixes them with Library reads as though there were a choice.
        //
        // Four links and no more: a destination's sections are drawn only while the operator is
        // inside it, so twenty-four rows of standing furniture is not a state this can reach.
        expect(screen.getAllByRole('link')).toHaveLength(labels.length);
        expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    });

    /**
     * The sections are here because a tab strip stopped fitting.
     *
     * Voice's eight tabs are 1122px of intrinsic width inside a 964px strip at a 1200px window, and
     * the strip hides its own scrollbar — so two of them were off the end with nothing saying so.
     * They are rows under the destination now, and only while the operator is in it.
     */
    it('lists a destination’s sections while the operator is inside it, and not before', () => {
        render(<SideNav />);
        expect(screen.queryByRole('link', { name: /What it said/ })).not.toBeInTheDocument();

        pathname = '/voice';
        render(<SideNav />);

        // The two that were off the end of the strip, and one from the middle of it.
        for (const section of ['Productions', 'What it said', 'Pronunciations']) {
            expect(screen.getByRole('link', { name: new RegExp(section) })).toBeInTheDocument();
        }
        // Library's are not drawn beside them: one destination is expanded at a time.
        expect(screen.queryByRole('link', { name: /Playlists/ })).not.toBeInTheDocument();
    });

    /**
     * The sentence is a tooltip, and a tooltip is not a thing a screen reader reaches.
     *
     * Settings' ten sections carried theirs as a second line of prose, which is 500px of rail; with
     * every destination's sections drawn here that shape would not fit. The name is what carries it
     * instead, so the reading is the same either way.
     */
    it('says what a section is in its name, since the sentence itself is only a tooltip', () => {
        pathname = '/voice';
        render(<SideNav />);

        expect(screen.getByRole('link', { name: 'Pronunciations. Names it was getting wrong' })).toBeInTheDocument();
    });

    /**
     * The letter is a shortcut affordance, not part of the destination's name.
     *
     * Mantine folds a section into the link's accessible name the same way it does the badge, so an
     * unguarded hint renames "Desk" to "D Desk" — a label with a keycap stuck on the front of it.
     */
    it('draws the key beside each destination without putting it in the name', () => {
        render(<SideNav />);

        for (const [hint, label] of [
            ['D', 'Desk'],
            ['P', 'Programme'],
            ['L', 'Library'],
            ['V', 'Voice'],
        ]) {
            expect(screen.getByText(hint as string)).toBeInTheDocument();
            expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
        }
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
        // Two rows on the catalog is one badge saying 2 on Library. The third counts against
        // Settings, which is not in this list — it badges the footer, covered in its own test.
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
        expect(screen.queryByText('1')).not.toBeInTheDocument();
    });

    it('says what a badge means in words, rather than sticking its number on the name', () => {
        // Mantine folds a `rightSection` into the link's accessible name, so an unguarded badge
        // renames "Library" to "Library 4" for a screen reader. The badge stays hidden and the link
        // carries the sentence instead, so the shortcut exists for somebody not looking at it.
        render(<SideNav attention={[{ code: 'benchedCopies', severity: 'warning', title: 'a', detail: 'a', route: '/catalog' }]} />);

        expect(screen.getByRole('link', { name: 'Library, 1 thing needs attention' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Library 1' })).not.toBeInTheDocument();
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

        expect(screen.getByRole('link', { name: 'Library, 2 things need attention' })).toBeInTheDocument();
    });

    /** A link with nothing waiting keeps its plain name rather than announcing that nothing is wrong. */
    it('leaves a link with nothing waiting exactly as it was', () => {
        render(<SideNav />);

        expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    });
});
