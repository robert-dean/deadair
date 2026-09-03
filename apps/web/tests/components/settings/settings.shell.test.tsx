import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsShell } from '../../../src/components/settings/settings.shell';
import { render, screen } from '../../utils/render';

// Whether this is being read on a phone, which is the only thing the shell asks its surroundings.
let phone = false;

vi.mock('../../../src/components/shared/use.phone', () => ({ usePhone: () => phone }));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...props }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

afterEach(() => {
    phone = false;
});

describe('SettingsShell', () => {
    it('draws the destination and embeds whatever section it is given', () => {
        render(
            <SettingsShell active="rotation">
                <div>the rotation settings</div>
            </SettingsShell>,
        );

        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        expect(screen.getByText('the rotation settings')).toBeInTheDocument();
        // Not asserted here: that a section draws no `<h1>` of its own. `EmbeddedPage` suppresses
        // `PageHeader`'s heading through context, not any heading a child happens to render, so a
        // literal `<h1>` in this test would pass straight through and prove nothing either way.
    });

    // It navigated the sections three ways: anchors down one long page, then a strip of ten tabs,
    // and now neither. The rail lists them on a desk and `SettingsIndex` does on a phone, so a
    // navigator here would be a third copy of one list and the one with least room for it.
    it('navigates nothing itself, on the widths where something else does', () => {
        render(
            <SettingsShell active="rotation">
                <div />
            </SettingsShell>,
        );

        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Measurement' })).not.toBeInTheDocument();
    });

    it('says the sections save separately, where the section list used to', () => {
        render(
            <SettingsShell active="station">
                <div />
            </SettingsShell>,
        );

        // The write is partial, so a section cannot clear another. Worth saying out loud: a settings
        // page whose one button writes forty keys makes every change feel consequential.
        expect(screen.getByText(/Every section saves on its own/)).toBeInTheDocument();
    });

    describe('on a phone', () => {
        it('offers the way back to the list, which the collapsed rail no longer is', () => {
            phone = true;
            render(
                <SettingsShell active="rotation">
                    <div />
                </SettingsShell>,
            );

            expect(screen.getByRole('link', { name: 'All settings' })).toHaveAttribute('href', '/settings');
        });

        it('offers no way back from the list itself', () => {
            // `active` absent IS the list. A link here would point at the page the operator is on.
            phone = true;
            render(
                <SettingsShell>
                    <div />
                </SettingsShell>,
            );

            expect(screen.queryByRole('link', { name: 'All settings' })).not.toBeInTheDocument();
        });
    });

    it('draws no way back on a desk, where the rail is already one', () => {
        render(
            <SettingsShell active="rotation">
                <div />
            </SettingsShell>,
        );

        expect(screen.queryByRole('link', { name: 'All settings' })).not.toBeInTheDocument();
    });
});
