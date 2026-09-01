import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_SECTIONS, SettingsShell } from '../../../src/components/settings/settings.shell';
import { render, screen, within } from '../../utils/render';

// The suite's convention for a component that links: the real router needs a route tree this test
// has no use for. The rest of the props are spread through rather than dropped, because these links
// carry the styling that says which section is being read — a mock that swallows it would answer
// every assertion below with "no section is lit".
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, to, hash, params, search, ...rest }: { children?: ReactNode; [key: string]: unknown }) => (
        <a href="#" {...rest}>
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
            <SettingsShell active="settings">
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
            <SettingsShell active="settings">
                <div />
            </SettingsShell>,
        );

        // Once in the column and once in the strip that replaces it below `md`. Both are always in
        // the document; which one is shown is a media query, and CSS is not what this asserts.
        for (const section of SETTINGS_SECTIONS) {
            expect(screen.getAllByText(section.label)).toHaveLength(2);
        }
    });

    it('lights the first section before anything has been scrolled', () => {
        render(
            <SettingsShell active="settings">
                <div />
            </SettingsShell>,
        );

        // An unlit list at the top of a page reads as broken rather than as "you are above the
        // first section". Nothing has passed the header yet, so the first one wins.
        const links = within(sectionNav()).getAllByRole('link');
        expect(isLit(links[0]!)).toBe(true);
        expect(isLit(links[1]!)).toBe(false);
    });

    it('lights nothing on the plugins route, where the sections are not in the document', () => {
        render(
            <SettingsShell active="plugins">
                <div />
            </SettingsShell>,
        );

        // From here the section links point at another route, so there is no section being read.
        // Plugins is what is lit instead, and it is the only thing that should be.
        const lit = within(sectionNav()).getAllByRole('link').filter(isLit);
        expect(lit).toHaveLength(1);
        expect(lit[0]).toHaveTextContent('Plugins');
    });
});
