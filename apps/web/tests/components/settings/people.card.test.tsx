import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { PeopleCard } from '../../../src/components/settings/people.card';
import { clearSession } from '../../../src/auth/session.store';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const listUsers = vi.fn();
const getUser = vi.fn();
const changeUserRole = vi.fn();
const deactivateUser = vi.fn();
const reactivateUser = vi.fn();
const signOutUser = vi.fn();
const resetUserMFA = vi.fn();
const readSession = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        authentication: {
            sessions: { readSession: (...args: unknown[]) => readSession(...args) },
            factors: { startMFAChallenge: vi.fn() },
        },
        users: {
            listUsers: (...args: unknown[]) => listUsers(...args),
            getUser: (...args: unknown[]) => getUser(...args),
            changeUserRole: (...args: unknown[]) => changeUserRole(...args),
            deactivateUser: (...args: unknown[]) => deactivateUser(...args),
            reactivateUser: (...args: unknown[]) => reactivateUser(...args),
            signOutUser: (...args: unknown[]) => signOutUser(...args),
            resetUserMFA: (...args: unknown[]) => resetUserMFA(...args),
        },
    },
}));

afterEach(() => {
    for (const mock of [listUsers, getUser, changeUserRole, deactivateUser, reactivateUser, signOutUser, resetUserMFA, readSession]) mock.mockReset();
    clearSession();
});

const CREATED = DateTime.fromISO('2026-09-01T12:00:00Z');
const ME = {
    id: 'u-me',
    email: 'operator@example.com',
    role: 'admin',
    active: true,
    createdAt: CREATED,
    lastSignInAt: CREATED,
    hasStrongFactor: true,
};
const FRIEND = { id: 'u-friend', email: 'friend@example.com', role: 'listener', active: true, createdAt: CREATED, hasStrongFactor: false };

const page = (data: unknown[]) => ({ meta: { page: 0, pageSize: 25, sort: 'asc', total: data.length }, data });
const detail = (person: typeof FRIEND | typeof ME) => ({
    ...person,
    factors: [{ method: 'password', methodId: 'p', kind: 'knowledge', label: 'password' }],
    sessions: [],
    signIns: [],
});

describe('PeopleCard', () => {
    it('lists everybody with their role and how they sign in, and marks you', async () => {
        readSession.mockResolvedValue({ actorId: 'u-me', roles: ['admin'] });
        listUsers.mockResolvedValue(page([ME, FRIEND]));
        render(<PeopleCard />);

        const friend = (await screen.findByText('friend@example.com')).closest('tr')!;
        expect(within(friend).getByText('Listener')).toBeInTheDocument();
        expect(within(friend).getByText('Password only')).toBeInTheDocument();
        expect(within(friend).getByText('Never')).toBeInTheDocument();

        const me = screen.getByText('operator@example.com').closest('tr')!;
        expect(within(me).getByText('You')).toBeInTheDocument();
        expect(within(me).getByText('Authenticator or passkey')).toBeInTheDocument();
        expect(screen.getByText('2 people')).toBeInTheDocument();
    });

    it('opens on active people, and asks again when the status filter changes', async () => {
        readSession.mockResolvedValue({ actorId: 'u-me', roles: ['admin'] });
        listUsers.mockResolvedValue(page([FRIEND]));
        const user = setupUser();
        render(<PeopleCard />);

        await screen.findByText('friend@example.com');
        expect(listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, page: 0 }));

        await user.click(screen.getByText('Everyone'));
        await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith(expect.not.objectContaining({ active: expect.anything() })));
    });

    it('switches a person off from their drawer, after asking', async () => {
        readSession.mockResolvedValue({ actorId: 'u-me', roles: ['admin'] });
        listUsers.mockResolvedValue(page([FRIEND]));
        getUser.mockResolvedValue(detail(FRIEND));
        deactivateUser.mockResolvedValue({ ...FRIEND, active: false });
        const user = setupUser();
        render(<PeopleCard />);

        await user.click(await screen.findByRole('button', { name: 'Manage' }));
        await user.click(await screen.findByRole('button', { name: 'Switch off' }));
        const dialog = await screen.findByRole('dialog', { name: 'Switch friend@example.com off?' });
        await user.click(within(dialog).getByRole('button', { name: 'Switch off' }));

        await waitFor(() => expect(deactivateUser).toHaveBeenCalledWith('u-friend'));
    });

    it('keeps your own role and switch-off out of reach, and says why', async () => {
        readSession.mockResolvedValue({ actorId: 'u-me', roles: ['admin'] });
        listUsers.mockResolvedValue(page([ME]));
        getUser.mockResolvedValue(detail(ME));
        const user = setupUser();
        render(<PeopleCard />);

        await user.click(await screen.findByRole('button', { name: 'Manage' }));

        expect(await screen.findByText('This is your account. Your own role and status are changed by another admin.')).toBeInTheDocument();
        const drawer = screen.getByRole('dialog');
        expect(within(drawer).getAllByLabelText('Role')[0]).toBeDisabled();
        expect(within(drawer).queryByRole('button', { name: 'Switch off' })).not.toBeInTheDocument();
        expect(within(drawer).getByRole('button', { name: 'Reset second step' })).toBeInTheDocument();
    });
});
