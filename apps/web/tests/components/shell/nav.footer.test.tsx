import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavFooter } from '../../../src/components/shell/nav.footer';
import { SETTINGS_SECTIONS } from '../../../src/components/settings/settings.shell';
import { render, screen, setupUser } from '../../utils/render';

/** What each link asked the router to match on, keyed by its route. See `exactOf`. */
const activeOptionsByRoute = new Map<string, { exact?: boolean } | undefined>();

// Where the operator is, which is the only thing the footer asks the router. Set per test.
let pathname = '/';

// `Link` renders an anchor and `useRouterState` answers the one selector this component runs. Both
// are the whole of its router surface; `activeOptions` is dropped with the rest, since the active
// state is the router's own `data-status` and nothing here draws it.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, activeOptions, ...props }: { to?: string; children?: ReactNode; activeOptions?: { exact?: boolean } }) => {
        // Keyed by route rather than by label: Mantine hands `renderRoot` its already-rendered
        // content, so `children` here is an element and never the text of the link.
        if (to !== undefined) activeOptionsByRoute.set(to, activeOptions);
        return (
            <a href={to} {...props}>
                {children}
            </a>
        );
    },
    useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) => select({ location: { pathname } }),
}));

afterEach(() => {
    pathname = '/';
    activeOptionsByRoute.clear();
});

/**
 * What `activeOptions` a link asked for, read off the mock's own record.
 *
 * The mock drops the prop rather than rendering it, because an anchor has nowhere to put it, so it
 * is captured on the way through instead. Without this the exactness rule is invisible to a test and
 * would come back the next time somebody simplified this component.
 */
const exactOf = (route: string): boolean | undefined => activeOptionsByRoute.get(route)?.exact;

describe('NavFooter', () => {
    it('holds the two places an operator arrives at rather than goes to', () => {
        render(<NavFooter />);

        expect(screen.getByRole('link', { name: 'Check-up' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
        expect(screen.getAllByRole('link')).toHaveLength(2);
    });

    // The rail an operator sees on every other page is still what it was. Ten permanent extra rows
    // would be a lot of standing furniture for somewhere nobody opens the console to look at, and it
    // is what would make this the old grouped nav coming back rather than one exception to it.
    it('keeps the settings sections out of the rail everywhere else', () => {
        render(<NavFooter />);

        expect(screen.queryByRole('link', { name: 'Rotation' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Measurement' })).not.toBeInTheDocument();
    });

    it('opens Settings out into its sections once the operator is inside it', () => {
        pathname = '/settings/rotation';
        render(<NavFooter />);

        // Every section, drawn from the one list rather than a second copy of it. Matched by a
        // prefix rather than the bare label: a nested row's hint has nowhere else to go now that
        // Check-up's four sit beside Settings' ten, so it is folded into the accessible name — see
        // the case below.
        for (const section of SETTINGS_SECTIONS) {
            expect(screen.getByRole('link', { name: new RegExp(`^${section.label}\\.`) })).toBeInTheDocument();
        }
        expect(screen.getAllByRole('link')).toHaveLength(2 + SETTINGS_SECTIONS.length);
    });

    it('counts Plugins as being inside Settings, because it is one of the sections', () => {
        // Its route was never under `/settings`, which is a fact about the URL rather than about
        // where an operator is.
        pathname = '/plugins';
        render(<NavFooter />);

        expect(screen.getByRole('link', { name: /^Station\./ })).toBeInTheDocument();
    });

    /**
     * "Words" and "Measurement" name subjects rather than settings, so the label alone does not tell
     * an operator looking for the model which one to open — and the sentence saying so is now a
     * TOOLTIP rather than a second line, because the rail draws every destination's sections and a
     * line of prose under all of them the way Settings alone used to have it would not fit. The
     * accessible name is where it still reads, for anybody who cannot rest a pointer on the row.
     */
    it('says what each section holds, in the name a screen reader gets even though the eye gets a tooltip', () => {
        pathname = '/settings/station';
        render(<NavFooter />);

        expect(screen.getByRole('link', { name: 'Words. Which plugin it asks for words' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Measurement. Which plugin measures records' })).toBeInTheDocument();
    });

    it('matches both destinations exactly, so neither lights up beside whichever section is open', () => {
        pathname = '/settings/rotation';
        render(<NavFooter />);

        // Both carry sections now — Check-up's four joined Settings' ten — so both need the exact
        // match, on the same argument `side.nav.tsx` makes for a destination with children: without
        // it the router's default prefix match lights the parent up beside every child too, and the
        // rail says the operator is in two places at once.
        expect(exactOf('/settings')).toBe(true);
        expect(exactOf('/checkup')).toBe(true);
        // The sections themselves ask for nothing at all rather than for `{ exact: false }`. They
        // read the same and are not: naming it replaces the router's whole default, `includeSearch`
        // included.
        expect(activeOptionsByRoute.get('/settings/rotation')).toBeUndefined();
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
