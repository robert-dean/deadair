import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/grants')({ component: GrantsSettingsRoute });

/** Waiting on you: what plugins have asked for. */
function GrantsSettingsRoute() {
    return (
        <SettingsShell active="grants">
            <SettingsSectionPage section="grants" />
        </SettingsShell>
    );
}
