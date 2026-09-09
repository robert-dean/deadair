import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

export const Route = createFileRoute('/settings/mail')({ component: MailSettingsRoute });

/** Mail: the server the station sends sign-in codes and links through. */
function MailSettingsRoute() {
    return (
        <SettingsShell active="mail">
            <SettingsSectionPage section="mail" />
        </SettingsShell>
    );
}
