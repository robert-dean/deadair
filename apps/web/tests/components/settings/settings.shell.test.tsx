import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_ROUTES, SETTINGS_SECTIONS, SettingsShell } from '../../../src/components/settings/settings.shell';
import { render, screen, within } from '../../utils/render';

// The suite's convention for a component that links: the real router needs a route tree this test
// has no use for. The rest of the props are spread through rather than dropped, because these links
// carry the styling that says which section is being read — a mock that swallows it would answer
// every assertion below with "no section is lit".
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, to, hash, params, search, ...rest }: { children?: ReactNode; [key: string]: unknown }) => (
        <a href={String(to)} {...rest}>
            {children}
        </a>
    ),
}));

/** The column beside the cards, which is the one hidden below `md`. */
function sectionNav(): HTMLElement {
    return screen.getByRole('navigation', { name: /settings sections/i });
}

/** Whether a link is drawing the phosphor bar, read off the style it actually carries. */
function isLit(link: HTMLElement): boolean {
    return link.getAttribute('style')?.includes('var(--da-phosphor)') === true;
}

describe('SettingsShell', () => {
    it('says what each section holds, not just what it is called', () => {
        render(
            <SettingsShell active="station">
                <div />
            </SettingsShell>,
        );

        // The half a bare label leaves out: "Words" and "Measurement" name subjects rather than
        // settings, so an operator looking for the model cannot tell which one to open.
        for (const section of SETTINGS_SECTIONS) {
            expect(within(sectionNav()).getByText(section.label)).toBeInTheDocument();
            expect(within(sectionNav()).getByText(section.hint)).toBeInTheDocument();
        }
    });

    it('offers every section twice, so a phone is not left with one long scroll', () => {
        render(
            <SettingsShell active="station">
                <div />
            </SettingsShell>,
        );

        // Once in the column and once in the strip that replaces it below `md`. Both are always in
        // the document; which one is shown is a media query, and CSS is not what this asserts.
        for (const section of SETTINGS_SECTIONS) {
            expect(screen.getAllByText(section.label)).toHaveLength(2);
        }
    });

    // The lit section used to come from a scroll spy, which could disagree with the address bar and
    // had to be told to light nothing at all on the plugins route. It is the route now, so these
    // two cases are one question asked twice: whatever the shell was told it is showing, and only
    // that.
    it('lights the section it is showing, and only that one', () => {
        render(
            <SettingsShell active="rotation">
                <div />
            </SettingsShell>,
        );

        const lit = within(sectionNav()).getAllByRole('link').filter(isLit);
        expect(lit).toHaveLength(1);
        expect(lit[0]).toHaveTextContent('Rotation');
    });

    it('lights Plugins on the plugins route, which is a section like any other now', () => {
        render(
            <SettingsShell active="plugins">
                <div />
            </SettingsShell>,
        );

        const lit = within(sectionNav()).getAllByRole('link').filter(isLit);
        expect(lit).toHaveLength(1);
        expect(lit[0]).toHaveTextContent('Plugins');
    });

    it('points every section at its own route rather than at an anchor', () => {
        render(
            <SettingsShell active="station">
                <div />
            </SettingsShell>,
        );

        // The mock below renders `to` as the href, so this reads what the shell actually asked for.
        // A section that still linked to a hash would scroll a page that no longer exists.
        const hrefs = within(sectionNav())
            .getAllByRole('link')
            .map(link => link.getAttribute('href'));

        expect(hrefs).toEqual(SETTINGS_SECTIONS.map(section => SETTINGS_ROUTES[section.id]));
    });
});
