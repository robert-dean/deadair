import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/station')({ component: StationSettingsRoute });

/** Station: the station itself: what it is called, where it is, and the clock it tells the time by. */
function StationSettingsRoute() {
    return (
        <SettingsShell active="station">
            <SettingsSectionPage section="station" />
        </SettingsShell>
    );
}
