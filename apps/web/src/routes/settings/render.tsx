import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/render')({ component: RenderSettingsRoute });

/** Voice and audio: how the station speaks, and how a programme written in parts is put together. */
function RenderSettingsRoute() {
    return (
        <SettingsShell active="render">
            <SettingsSectionPage section="render" />
        </SettingsShell>
    );
}
