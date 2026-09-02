import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_ROUTES, SETTINGS_SECTIONS, SettingsShell } from '../../../src/components/settings/settings.shell';
import { render, screen, setupUser, within } from '../../utils/render';

// `DestinationTabs` navigates on select rather than linking, so the router is stubbed to the one
// hook the shell reaches for. This is what the tabs were chosen for over Mantine's own: the router
// is the only state, so the thing worth asserting is where a tab sends you.
const navigate = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
}));

/** The strip, which is one nav for both widths where there used to be two. */
function tabs(): HTMLElement[] {
    return within(screen.getByRole('tablist', { name: 'Settings' })).getAllByRole('tab');
}

describe('SettingsShell', () => {
    it('offers every section exactly once', () => {
        render(
            <SettingsShell active="station">
                <div />
            </SettingsShell>,
        );

        // Once, where the sidebar and the phone strip drew every section twice and the phone's copy
        // left Plugins out entirely.
        expect(tabs().map(tab => tab.textContent)).toEqual(SETTINGS_SECTIONS.map(section => section.label));
    });

    it('marks the section it is showing, and only that one', () => {
        render(
            <SettingsShell active="rotation">
                <div />
            </SettingsShell>,
        );

        // It was a scroll spy, which could disagree with the address bar and had to be told to
        // light nothing on the plugins route. It is the route now, so it cannot.
        const selected = tabs().filter(tab => tab.getAttribute('aria-selected') === 'true');
        expect(selected).toHaveLength(1);
        expect(selected[0]).toHaveTextContent('Rotation');
    });

    it('marks Plugins on the plugins route, which is a section like any other now', () => {
        render(
            <SettingsShell active="plugins">
                <div />
            </SettingsShell>,
        );

        const selected = tabs().filter(tab => tab.getAttribute('aria-selected') === 'true');
        expect(selected).toHaveLength(1);
        expect(selected[0]).toHaveTextContent('Plugins');
    });

    it('navigates to a section rather than scrolling to it', async () => {
        render(
            <SettingsShell active="station">
                <div />
            </SettingsShell>,
        );

        await setupUser().click(screen.getByRole('tab', { name: 'Measurement' }));

        expect(navigate).toHaveBeenCalledWith({ to: '/settings/analysis' });
    });

    it('sends Plugins out of /settings, since that is where it already lived', async () => {
        // The heterogeneous entry, and the shell does not special-case it: `SETTINGS_ROUTES` is
        // what knows a section's URL, and it is the only thing that does.
        render(
            <SettingsShell active="station">
                <div />
            </SettingsShell>,
        );

        await setupUser().click(screen.getByRole('tab', { name: 'Plugins' }));

        expect(navigate).toHaveBeenCalledWith({ to: SETTINGS_ROUTES.plugins });
        expect(SETTINGS_ROUTES.plugins).toBe('/plugins');
    });
});
