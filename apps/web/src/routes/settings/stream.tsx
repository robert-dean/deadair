import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/stream')({ component: StreamSettingsRoute });

/** Stream: the mounts the station publishes to, their formats and bitrates, and how HLS is served. */
function StreamSettingsRoute() {
    return (
        <SettingsShell active="stream">
            <SettingsSectionPage section="stream" />
        </SettingsShell>
    );
}
