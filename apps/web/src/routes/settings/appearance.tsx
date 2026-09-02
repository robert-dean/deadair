import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/appearance')({ component: AppearanceSettingsRoute });

/** Appearance: how the console looks, remembered on this browser and nowhere else. */
function AppearanceSettingsRoute() {
    return (
        <SettingsShell active="appearance">
            <SettingsSectionPage section="appearance" />
        </SettingsShell>
    );
}
