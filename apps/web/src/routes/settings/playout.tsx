import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/playout')({ component: PlayoutSettingsRoute });

/** Playout: what puts the station on air. */
function PlayoutSettingsRoute() {
    return (
        <SettingsShell active="playout">
            <SettingsSectionPage section="playout" />
        </SettingsShell>
    );
}
