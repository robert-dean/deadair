import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/housekeeping')({ component: HousekeepingSettingsRoute });

/** Housekeeping: how long the station keeps its own history, and how much of a sync it will trust. */
function HousekeepingSettingsRoute() {
    return (
        <SettingsShell active="housekeeping">
            <SettingsSectionPage section="housekeeping" />
        </SettingsShell>
    );
}
