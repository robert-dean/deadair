import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/analysis')({ component: AnalysisSettingsRoute });

/** Measurement: which plugin measures records. */
function AnalysisSettingsRoute() {
    return (
        <SettingsShell active="analysis">
            <SettingsSectionPage section="analysis" />
        </SettingsShell>
    );
}
