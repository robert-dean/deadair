import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../api/query.keys';
import { isForbidden } from '../../api/sdk.error';
import { useCurrentSession } from '../../api/users.queries';

/** Split out of `__root.tsx` unchanged: who the shell is drawing for. */
export function useShellAccount(signedIn: boolean) {
    // Which roles the signed-in person holds. The desk is drawn only for an admin; anybody else gets
    // their own account, and nothing of the station's controls is fetched for them at all.
    const account = useCurrentSession(signedIn);
    // Forgotten the moment nobody is signed in, so the next person to sign in on this browser is
    // asked about afresh rather than drawn with the last one's roles. Logout clears the whole cache
    // already; a session that simply runs out does not go through it.
    const queryClient = useQueryClient();
    useEffect(() => {
        if (!signedIn) queryClient.removeQueries({ queryKey: queryKeys.auth.session() });
    }, [queryClient, signedIn]);
    const isAdmin = account.data?.roles.includes('admin') ?? false;
    // A 403 is the answer for an account holding no role whatever, which is no admin either. Any
    // other failure is the API being unwell, which the banner reports, and is not a reason to take
    // an admin's desk away from them.
    const noRole = isForbidden(account.error);
    const roleKnown = account.data !== undefined || account.isError;
    const desk = signedIn && isAdmin;

    return { account, isAdmin, noRole, roleKnown, desk };
}
