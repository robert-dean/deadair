import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InvitationCreate, PlatformRole } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * The station's people, for the People section.
 *
 * Every mutation is `retry: false`, as the factor and key mutations are: each one is behind the
 * re-verify dialog, which runs it a second time itself after a code, and a retry behind the
 * operator's back would answer a step-up with a second step-up. Each one invalidates every list and
 * the person's own page at once, because a role change or a switch-off moves a person between
 * filtered lists.
 */

export interface UsersFilter {
    page: number;
    pageSize: number;
    search?: string;
    role?: PlatformRole;
    active?: boolean;
}

export function usersOptions(filter: UsersFilter) {
    return queryOptions({
        queryKey: queryKeys.users.list(filter),
        queryFn: () =>
            sdk.users.listUsers({
                page: filter.page,
                pageSize: filter.pageSize,
                sort: 'asc',
                ...(filter.search ? { search: filter.search } : {}),
                ...(filter.role ? { role: filter.role } : {}),
                ...(filter.active === undefined ? {} : { active: filter.active }),
            }),
        // Keeps the rows on screen while the next page or filter loads, so the table does not
        // collapse to a skeleton and back on every keystroke in the search box.
        placeholderData: keepPreviousData,
    });
}

/** One page of people, oldest account first. */
export function useUsers(filter: UsersFilter) {
    return useQuery(usersOptions(filter));
}

/** One person, with how they sign in, where they are signed in and their recent sign-ins. */
export function useUser(id: string | undefined) {
    return useQuery({
        queryKey: queryKeys.users.detail(id ?? ''),
        queryFn: () => sdk.users.getUser(id!),
        enabled: id !== undefined,
    });
}

/** Who is signed in, so a person's own row can say so and keep its controls off. */
export function useCurrentSession() {
    return useQuery({ queryKey: queryKeys.auth.session(), queryFn: () => sdk.authentication.sessions.readSession() });
}

function usePersonMutation<T>(run: (id: string) => Promise<T>) {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id }: { id: string }) => run(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
        },
    });
}

/** Gives a person a different role, which replaces the one they had. */
export function useChangeUserRole() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id, role }: { id: string; role: PlatformRole }) => sdk.users.changeUserRole(id, { role }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
        },
    });
}

/** Switches a person off. Nothing is deleted, and switching them back on restores everything. */
export function useDeactivateUser() {
    return usePersonMutation(id => sdk.users.deactivateUser(id));
}

export function useReactivateUser() {
    return usePersonMutation(id => sdk.users.reactivateUser(id));
}

/** Signs a person out everywhere. */
export function useSignOutUser() {
    return usePersonMutation(id => sdk.users.signOutUser(id));
}

/** Removes a person's authenticator apps and passkeys, for a lost device, and signs them out. */
export function useResetUserMfa() {
    return usePersonMutation(id => sdk.users.resetUserMFA(id));
}

/** Every invitation, newest first, each open one with its link. */
export function useInvitations() {
    return useQuery({ queryKey: queryKeys.users.invitations(), queryFn: () => sdk.users.invitations.listInvitations() });
}

/**
 * Invites an address into a role. An open invitation to the same address is withdrawn first, so this
 * is also "send it again". Behind the re-verify dialog, and so `retry: false`.
 */
export function useCreateInvitation() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: (body: InvitationCreate) =>
            sdk.users.invitations.createInvitation({ email: body.email.trim(), role: body.role, ...(body.send ? { send: true } : {}) }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.users.invitations() });
        },
    });
}

/** Withdraws an invitation. Its link stops working; it stays in the list, marked withdrawn. */
export function useRevokeInvitation() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id }: { id: string }) => sdk.users.invitations.revokeInvitation(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.users.invitations() });
        },
    });
}

/** The address an invitation's link opens: this console's origin, the invite page, the token after `#`. */
export const invitationLink = (token: string, origin: string = window.location.origin): string => `${origin}/invite#${token}`;
