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
    // `activeOptions` is drawn as an attribute, since how a row matches is the router's to apply and
    // this test's only to see asked for. So is an empty `activeProps`, which is a row asking never to
    // be lit. `search` is dropped: an anchor has no use for it.
    Link: ({
        to,
        children,
        activeOptions,
        activeProps,
        search: _search,
        ...props
    }: {
        to?: string;
        children?: ReactNode;
        activeOptions?: { exact?: boolean };
        activeProps?: object;
        search?: unknown;
    }) => (
        <a
            href={to}
            data-exact={activeOptions?.exact ? 'true' : undefined}
            data-never-active={activeProps !== undefined && Object.keys(activeProps).length === 0 ? 'true' : undefined}
            {...props}
        >
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
     * The default tab's row asks for no search, because the route strips the default from the URL, and
     * the router counts an empty search as part of every other tab's. Matched loosely, Today was lit
     * beside Leans and rules, and Characters beside every other Voice tab.
     */
    it('matches only the default tab’s row exactly, so it is not lit beside another tab', () => {
        pathname = '/schedule';
        render(<SideNav />);

        expect(screen.getByRole('link', { name: /^Today/ })).toHaveAttribute('data-exact', 'true');
        expect(screen.getByRole('link', { name: /^Leans and rules/ })).not.toHaveAttribute('data-exact');
    });

    it('does the same for Voice, whose other tabs stay lit while a link narrows them', () => {
        pathname = '/voice';
        render(<SideNav />);

        expect(screen.getByRole('link', { name: /^Characters/ })).toHaveAttribute('data-exact', 'true');
        expect(screen.getByRole('link', { name: /^What it said/ })).not.toHaveAttribute('data-exact');
    });

    /**
     * On Tracks the rail lit three rows. Library is `/catalog/tracks` exactly as Tracks is, and Artists
     * is `/catalog`, which the router's prefix match counts as a parent of `/catalog/tracks`.
     */
    it('lights only the Library section the operator is on', () => {
        pathname = '/catalog/tracks';
        render(<SideNav />);

        expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('data-never-active', 'true');
        expect(screen.getByRole('link', { name: /^Artists/ })).toHaveAttribute('data-exact', 'true');
        expect(screen.getByRole('link', { name: /^Tracks/ })).not.toHaveAttribute('data-never-active');
        // Collapsed destinations have nothing beneath them to say so instead.
        expect(screen.getByRole('link', { name: 'Voice' })).not.toHaveAttribute('data-never-active');
    });

    it('draws one badge for one thing, on the section rather than beside it on Library too', () => {
        pathname = '/catalog/tracks';
        render(<SideNav attention={[{ code: 'benchedCopies', severity: 'warning', title: 'a', detail: 'a', route: '/catalog' }]} />);

        expect(screen.getAllByText('1')).toHaveLength(1);
        expect(screen.getByRole('link', { name: /^Tracks, 1 thing needs attention/ })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    });

    it('draws one badge on Voice’s first section, not on all eight that share its route', () => {
        pathname = '/voice';
        render(<SideNav attention={[{ code: 'persona', severity: 'warning', title: 'a', detail: 'a', route: '/personas' }]} />);

        expect(screen.getAllByText('1')).toHaveLength(1);
        expect(screen.getByRole('link', { name: /^Characters, 1 thing needs attention/ })).toBeInTheDocument();
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
