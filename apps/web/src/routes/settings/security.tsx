import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

/** What a provider hands back after linking: the provider's name, or why it was refused. */
export interface SecuritySearch {
    linked?: string;
    link_error?: string;
}

function validateSearch(search: Record<string, unknown>): SecuritySearch {
    const take = (key: keyof SecuritySearch): string | undefined => (typeof search[key] === 'string' ? search[key] : undefined);
    return { linked: take('linked'), link_error: take('link_error') };
}

export const Route = createFileRoute('/settings/security')({ component: SecuritySettingsRoute, validateSearch });

/** Security: how the operator signs in, which is the one section about a person rather than the station. */
function SecuritySettingsRoute() {
    return (
        <SettingsShell active="security">
            <SettingsSectionPage section="security" />
        </SettingsShell>
    );
}
