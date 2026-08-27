import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '../components/settings/settings.page';
import { SettingsShell } from '../components/settings/settings.shell';

export const Route = createFileRoute('/settings')({ component: SettingsRoute });

function SettingsRoute() {
    return (
        <SettingsShell active="settings">
            <SettingsPage />
        </SettingsShell>
    );
}
