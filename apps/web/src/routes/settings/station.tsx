import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/station')({ component: StationSettingsRoute });

/** Station: the station itself: what it is called, where it publishes, and the credentials that get it there. */
function StationSettingsRoute() {
    return (
        <SettingsShell active="station">
            <SettingsSectionPage section="station" />
        </SettingsShell>
    );
}
