import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { useLogoutMutation } from '../../api/auth.mutations';
import { apiErrorMessage } from '../../api/sdk.error';

/** Split out of `__root.tsx` unchanged: signing out, and whatever a failed revoke left to say. */
export function useLogoutFlow() {
    const { t } = useTranslation('routes');
    const navigate = useNavigate();
    const logout = useLogoutMutation();
    const [logoutError, setLogoutError] = useState<string | undefined>(undefined);

    async function handleLogout(): Promise<void> {
        let failure: string | undefined;
        try {
            await logout.mutateAsync();
        } catch (caught) {
            // A failed revoke must not strand the user in a signed-in shell, but it is not a
            // completed sign-out either: the mutation drops local state regardless, and the
            // shortfall is said out loud.
            const detail = apiErrorMessage(caught, '');
            failure = detail ? t('root.revokeFailedWithDetail', { detail }) : t('root.revokeFailed');
        }
        setLogoutError(failure);
        await navigate({ to: '/login' });
    }

    return { logout, logoutError, setLogoutError, handleLogout };
}
