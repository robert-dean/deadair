import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/bulletins')({ component: BulletinsSettingsRoute });

/** Bulletins: what the station reads of the news, the weather and the date. */
function BulletinsSettingsRoute() {
    return (
        <SettingsShell active="bulletins">
            <SettingsSectionPage section="bulletins" />
        </SettingsShell>
    );
}
