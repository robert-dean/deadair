import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/languages')({ component: LanguagesSettingsRoute });

/** Languages: which languages the console can be shown in, and the file a translation starts from. */
function LanguagesSettingsRoute() {
    return (
        <SettingsShell active="languages">
            <SettingsSectionPage section="languages" />
        </SettingsShell>
    );
}
