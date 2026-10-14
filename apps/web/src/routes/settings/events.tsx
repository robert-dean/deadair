import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/events')({ component: EventDestinationsSettingsRoute });

/** Event destinations: the operator's own servers, told what goes on air. */
function EventDestinationsSettingsRoute() {
    return (
        <SettingsShell active="events">
            <SettingsSectionPage section="events" />
        </SettingsShell>
    );
}
