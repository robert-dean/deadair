// A person's connected apps. Nothing is drawn until there is something to show, so a station that
// never turned OAuth on looks as it did; an app is disconnected after asking.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { ConnectedAppsCard } from '../../../src/components/settings/connected.apps.card';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listOAuthGrants = vi.fn();
const revokeOAuthGrant = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        oauth: {
            listOAuthGrants: (...args: unknown[]) => listOAuthGrants(...args),
            revokeOAuthGrant: (...args: unknown[]) => revokeOAuthGrant(...args),
        },
    },
}));

afterEach(() => {
    listOAuthGrants.mockReset();
    revokeOAuthGrant.mockReset();
});

const GRANT = {
    id: '11111111-1111-4111-8111-111111111111',
    clientId: 'dyn_1',
    clientName: 'Claude',
    resource: 'https://radio.example.com/api/mcp',
    scope: ['mcp'],
    createdAt: DateTime.fromISO('2026-09-20T10:00:00Z'),
};

describe('ConnectedAppsCard', () => {
    it('draws nothing for somebody with no connected app', async () => {
        listOAuthGrants.mockResolvedValue({ grants: [] });
        render(<ConnectedAppsCard />);

        await waitFor(() => expect(listOAuthGrants).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('Connected apps')).not.toBeInTheDocument());
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('lists a connected app by its name', async () => {
        listOAuthGrants.mockResolvedValue({ grants: [GRANT] });
        render(<ConnectedAppsCard />);

        expect(await screen.findByText('Connected apps')).toBeInTheDocument();
        expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    it('disconnects an app after asking', async () => {
        listOAuthGrants.mockResolvedValue({ grants: [GRANT] });
        revokeOAuthGrant.mockResolvedValue(undefined);
        render(<ConnectedAppsCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2));
        await user.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1)!);

        await waitFor(() => expect(revokeOAuthGrant).toHaveBeenCalledWith(GRANT.id));
    });
});
