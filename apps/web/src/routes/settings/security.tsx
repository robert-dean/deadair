import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/security')({ component: SecuritySettingsRoute });

/** Security: how the operator signs in, which is the one section about a person rather than the station. */
function SecuritySettingsRoute() {
    return (
        <SettingsShell active="security">
            <SettingsSectionPage section="security" />
        </SettingsShell>
    );
}
