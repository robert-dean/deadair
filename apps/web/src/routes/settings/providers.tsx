import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/providers')({ component: ProvidersSettingsRoute });

/** Providers: which plugin does each job more than one of them can do. */
function ProvidersSettingsRoute() {
    return (
        <SettingsShell active="providers">
            <SettingsSectionPage section="providers" />
        </SettingsShell>
    );
}
