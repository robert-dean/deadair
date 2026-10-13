import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { InvitationsCard } from '../../../src/components/settings/invitations.card';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const listInvitations = vi.fn();
const createInvitation = vi.fn();
const revokeInvitation = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        authentication: { factors: { startMFAChallenge: vi.fn() } },
        users: {
            invitations: {
                listInvitations: (...args: unknown[]) => listInvitations(...args),
                createInvitation: (...args: unknown[]) => createInvitation(...args),
                revokeInvitation: (...args: unknown[]) => revokeInvitation(...args),
            },
        },
    },
}));

afterEach(() => {
    for (const mock of [listInvitations, createInvitation, revokeInvitation]) mock.mockReset();
});

const NOW = DateTime.fromISO('2026-10-13T12:00:00Z');
const OPEN = {
    id: 'i-1',
    email: 'sam@friends.test',
    role: 'listener',
    state: 'pending',
    createdAt: NOW,
    expiresAt: NOW.plus({ days: 7 }),
    invitedBy: 'admin@deadair.test',
    token: 'di_listener',
};
const ADMIN = { ...OPEN, id: 'i-2', email: 'pat@friends.test', role: 'admin', token: 'di_admin', expiresAt: NOW.plus({ hours: 48 }) };
const USED = { ...OPEN, id: 'i-3', email: 'jo@friends.test', state: 'accepted', acceptedAt: NOW, token: undefined };

describe('InvitationsCard', () => {
    it('lists invitations with where each stands, and offers a link only on an open one', async () => {
        listInvitations.mockResolvedValue({ data: [OPEN, USED] });
        render(<InvitationsCard />);

        const open = (await screen.findByText('sam@friends.test')).closest('tr')!;
        expect(within(open).getByText('Open')).toBeInTheDocument();
        expect(within(open).getByRole('button', { name: 'Link' })).toBeInTheDocument();

        const used = screen.getByText('jo@friends.test').closest('tr')!;
        expect(within(used).getByText('Accepted')).toBeInTheDocument();
        expect(within(used).queryByRole('button', { name: 'Link' })).not.toBeInTheDocument();
        expect(within(used).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    });

    it('invites an address into a role, then shows the link to send', async () => {
        listInvitations.mockResolvedValue({ data: [] });
        createInvitation.mockResolvedValue(OPEN);
        const user = setupUser();
        render(<InvitationsCard />);

        await user.type(await screen.findByLabelText('Their address'), 'sam@friends.test');
        await user.click(screen.getByRole('button', { name: 'Create invitation' }));

        expect(createInvitation).toHaveBeenCalledWith({ email: 'sam@friends.test', role: 'listener' });
        const dialog = await screen.findByRole('dialog', { name: 'Invitation for sam@friends.test' });
        expect(within(dialog).getByText(`${window.location.origin}/invite#di_listener`)).toBeInTheDocument();
    });

    it("keeps an admin's link hidden until it is asked for a second time", async () => {
        listInvitations.mockResolvedValue({ data: [ADMIN] });
        const user = setupUser();
        render(<InvitationsCard />);

        await user.click(await screen.findByRole('button', { name: 'Link' }));
        const dialog = await screen.findByRole('dialog', { name: 'Invitation for pat@friends.test' });
        expect(within(dialog).queryByText(/di_admin/)).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Show the admin link' }));
        expect(within(dialog).getByText(`${window.location.origin}/invite#di_admin`)).toBeInTheDocument();
    });

    it('withdraws an invitation after asking', async () => {
        listInvitations.mockResolvedValue({ data: [OPEN] });
        revokeInvitation.mockResolvedValue({ ...OPEN, state: 'revoked' });
        const user = setupUser();
        render(<InvitationsCard />);

        await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
        const dialog = await screen.findByRole('dialog', { name: 'Withdraw the invitation for sam@friends.test?' });
        await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

        await waitFor(() => expect(revokeInvitation).toHaveBeenCalledWith('i-1'));
    });

    it('sends again by inviting the same address into the same role', async () => {
        listInvitations.mockResolvedValue({ data: [ADMIN] });
        createInvitation.mockResolvedValue({ ...ADMIN, id: 'i-9', token: 'di_new' });
        const user = setupUser();
        render(<InvitationsCard />);

        await user.click(await screen.findByRole('button', { name: 'Send again' }));
        const dialog = await screen.findByRole('dialog', { name: 'Make a new link for pat@friends.test?' });
        await user.click(within(dialog).getByRole('button', { name: 'Send again' }));

        await waitFor(() => expect(createInvitation).toHaveBeenCalledWith({ email: 'pat@friends.test', role: 'admin' }));
    });
});
