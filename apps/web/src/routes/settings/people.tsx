import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/people')({ component: PeopleSettingsRoute });

/** People: who has an account, the role each holds, and whether they can still sign in. */
function PeopleSettingsRoute() {
    return (
        <SettingsShell active="people">
            <SettingsSectionPage section="people" />
        </SettingsShell>
    );
}
