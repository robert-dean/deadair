import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/breaks')({ component: BreaksSettingsRoute });

/** Breaks: how often the station talks between records, and for how long. */
function BreaksSettingsRoute() {
    return (
        <SettingsShell active="breaks">
            <SettingsSectionPage section="breaks" />
        </SettingsShell>
    );
}
