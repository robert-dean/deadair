import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/storage')({ component: StorageSettingsRoute });

/** Storage: what the caches are holding. */
function StorageSettingsRoute() {
    return (
        <SettingsShell active="storage">
            <SettingsSectionPage section="storage" />
        </SettingsShell>
    );
}
