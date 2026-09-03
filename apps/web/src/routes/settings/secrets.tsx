import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/secrets')({ component: SecretsSettingsRoute });

/** Secrets: the passwords the station was seeded with, kept here for the one time they need matching. */
function SecretsSettingsRoute() {
    return (
        <SettingsShell active="secrets">
            <SettingsSectionPage section="secrets" />
        </SettingsShell>
    );
}
