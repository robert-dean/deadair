import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/rotation')({ component: RotationSettingsRoute });

/** Rotation: how the station programmes itself when nothing more specific is asked for. */
function RotationSettingsRoute() {
    return (
        <SettingsShell active="rotation">
            <SettingsSectionPage section="rotation" />
        </SettingsShell>
    );
}
