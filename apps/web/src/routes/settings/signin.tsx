import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/signin')({ component: SigninSettingsRoute });

/** Sign-in and connections: the identity providers the sign-in page offers, and who may join through one. */
function SigninSettingsRoute() {
    return (
        <SettingsShell active="signin">
            <SettingsSectionPage section="signin" />
        </SettingsShell>
    );
}
