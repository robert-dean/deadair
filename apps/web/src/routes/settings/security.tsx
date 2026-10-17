import { createFileRoute } from '@tanstack/react-router';

import { SettingsSectionPage } from '../../components/settings/settings.page';
import { SettingsShell } from '../../components/settings/settings.shell';

/** What a provider hands back after linking (the provider's name, or why it was refused), and `reset` on arrival from a password-reset link. */
export interface SecuritySearch {
    linked?: string;
    link_error?: string;
    reset?: boolean;
}

function validateSearch(search: Record<string, unknown>): SecuritySearch {
    const take = (key: 'linked' | 'link_error'): string | undefined => (typeof search[key] === 'string' ? search[key] : undefined);
    // The router reads `?reset=1` as JSON, so it arrives as the number; the string is accepted too.
    const reset = search.reset === 1 || search.reset === '1' || search.reset === true;
    return { linked: take('linked'), link_error: take('link_error'), ...(reset ? { reset } : {}) };
}

export const Route = createFileRoute('/settings/security')({ component: SecuritySettingsRoute, validateSearch });

/** Sign-in and security: how the operator signs in, then what the sign-in page offers everybody. */
function SecuritySettingsRoute() {
    return (
        <SettingsShell active="security">
            <SettingsSectionPage section="security" />
        </SettingsShell>
    );
}
