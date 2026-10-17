import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/telemetry')({ component: TelemetrySettingsRoute });

/** Telemetry: where the station sends its numbers over OpenTelemetry, if anywhere. */
function TelemetrySettingsRoute() {
    return (
        <SettingsShell active="telemetry">
            <SettingsSectionPage section="telemetry" />
        </SettingsShell>
    );
}
