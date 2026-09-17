import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/artwork')({ component: ArtworkSettingsRoute });

/** Artwork: the pictures a listener's player shows while the station is talking. */
function ArtworkSettingsRoute() {
    return (
        <SettingsShell active="artwork">
            <SettingsSectionPage section="artwork" />
        </SettingsShell>
    );
}
