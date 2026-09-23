// The apps registered with the station. The properties that matter: a secret appears once, on the
// response that made it; somebody without the operator role sees nothing rather than an error; and
// withdrawing an app is asked before it is done.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { OAuthClientsCard } from '../../../src/components/settings/oauth.clients.card';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listOAuthClients = vi.fn();
const createOAuthClient = vi.fn();
const revokeOAuthClient = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        oauth: {
            listOAuthClients: (...args: unknown[]) => listOAuthClients(...args),
            createOAuthClient: (...args: unknown[]) => createOAuthClient(...args),
            revokeOAuthClient: (...args: unknown[]) => revokeOAuthClient(...args),
        },
        authentication: { factors: { startMFAChallenge: vi.fn() } },
    },
}));

afterEach(() => {
    for (const mock of [listOAuthClients, createOAuthClient, revokeOAuthClient]) mock.mockReset();
});

const CLAUDE = {
    clientId: 'dyn_1',
    kind: 'dynamic',
    name: 'Claude',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    tokenEndpointAuthMethod: 'none',
    createdAt: DateTime.fromISO('2026-09-20T10:00:00Z'),
    expiresAt: DateTime.fromISO('2026-12-19T10:00:00Z'),
};

describe('OAuthClientsCard', () => {
    it('lists a self-registered app with the date it lapses', async () => {
        listOAuthClients.mockResolvedValue({ clients: [CLAUDE] });
        render(<OAuthClientsCard />);

        expect(await screen.findByText('Claude')).toBeInTheDocument();
        expect(screen.getByText('registered itself')).toBeInTheDocument();
        expect(screen.getByText(/lapses/)).toBeInTheDocument();
    });

    it('shows nothing to somebody without the operator role', async () => {
        listOAuthClients.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));
        render(<OAuthClientsCard />);

        await waitFor(() => expect(listOAuthClients).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('Registered apps')).not.toBeInTheDocument());
        expect(screen.queryByText('Apps unavailable')).not.toBeInTheDocument();
    });

    it('registers an app that keeps a secret and shows the secret once', async () => {
        listOAuthClients.mockResolvedValue({ clients: [] });
        createOAuthClient.mockResolvedValue({
            client: { ...CLAUDE, clientId: 'pre_1', kind: 'preregistered', name: 'Home Assistant' },
            clientSecret: 's3cret',
        });
        render(<OAuthClientsCard />);
        const user = setupUser();

        await user.type(await screen.findByLabelText('Name'), 'Home Assistant');
        await user.type(screen.getByLabelText('Where it may be sent back to'), 'https://ha.example/cb');
        await user.click(screen.getByRole('button', { name: 'Register' }));

        expect(await screen.findByText('s3cret')).toBeInTheDocument();
        expect(createOAuthClient).toHaveBeenCalledWith({
            name: 'Home Assistant',
            redirectUris: ['https://ha.example/cb'],
            tokenEndpointAuthMethod: 'none',
        });

        await user.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.queryByText('s3cret')).not.toBeInTheDocument();
    });

    it('withdraws an app after asking', async () => {
        listOAuthClients.mockResolvedValue({ clients: [CLAUDE] });
        revokeOAuthClient.mockResolvedValue(undefined);
        render(<OAuthClientsCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(2));
        await user.click(screen.getAllByRole('button', { name: 'Withdraw' }).at(-1)!);

        await waitFor(() => expect(revokeOAuthClient).toHaveBeenCalledWith('dyn_1'));
    });
});
