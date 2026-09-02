import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/llm')({ component: LlmSettingsRoute });

/** Words: which plugin the station asks for words. */
function LlmSettingsRoute() {
    return (
        <SettingsShell active="llm">
            <SettingsSectionPage section="llm" />
        </SettingsShell>
    );
}
