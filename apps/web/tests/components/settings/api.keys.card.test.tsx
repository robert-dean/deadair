import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { ApiKeysCard } from '../../../src/components/settings/api.keys.card';
import { clearSession } from '../../../src/auth/session.store';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

const listAPIKeys = vi.fn();
const createAPIKey = vi.fn();
const rotateAPIKey = vi.fn();
const revokeAPIKey = vi.fn();
const startMFAChallenge = vi.fn();
const requestToken = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
            factors: {
                startMFAChallenge: (...args: unknown[]) => startMFAChallenge(...args),
            },
            apikeys: {
                listAPIKeys: (...args: unknown[]) => listAPIKeys(...args),
                createAPIKey: (...args: unknown[]) => createAPIKey(...args),
                rotateAPIKey: (...args: unknown[]) => rotateAPIKey(...args),
                revokeAPIKey: (...args: unknown[]) => revokeAPIKey(...args),
            },
        },
    },
}));

afterEach(() => {
    for (const mock of [listAPIKeys, createAPIKey, rotateAPIKey, revokeAPIKey, startMFAChallenge, requestToken]) mock.mockReset();
    clearSession();
});

const CREATED = DateTime.fromISO('2026-09-01T12:00:00Z');
const DOORBELL = { id: 'k-1', name: 'Doorbell', hint: 'da_AbCdE', scopes: ['view'], createdAt: CREATED, lastUsedAt: CREATED.plus({ days: 3 }) };
const BACKUP = {
    id: 'k-2',
    name: 'Backup script',
    hint: 'da_XyZ12',
    scopes: ['view', 'manage'],
    createdAt: CREATED,
    revokedAt: CREATED.plus({ days: 1 }),
};
const TOKEN = 'da_0123456789abcdefghijABCDEFGHIJ0123456789abcDEFxyz123';

const stepUpDenied = () =>
    new SdkError(
        403,
        'Forbidden',
        {
            statusCode: 403,
            message: 'Forbidden',
            details: { kind: 'step_up_required', stepUp: { within: 'PT5M', excludeMethods: ['email', 'password', 'oidc'] } },
        },
        new Headers(),
    );

describe('ApiKeysCard', () => {
    it('lists the account’s keys with what each may do, and offers nothing on a revoked one', async () => {
        listAPIKeys.mockResolvedValue({ keys: [DOORBELL, BACKUP] });
        render(<ApiKeysCard />);

        const doorbell = (await screen.findByText('Doorbell')).closest('tr')!;
        expect(within(doorbell).getByText('Read only')).toBeInTheDocument();
        expect(within(doorbell).getByText('da_AbCdE…')).toBeInTheDocument();
        expect(within(doorbell).getByRole('button', { name: 'Rotate' })).toBeInTheDocument();

        const backup = screen.getByText('Backup script').closest('tr')!;
        expect(within(backup).getByText('Read and manage')).toBeInTheDocument();
        expect(within(backup).getByText('revoked')).toBeInTheDocument();
        expect(within(backup).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
        expect(within(backup).queryByRole('button', { name: 'Rotate' })).not.toBeInTheDocument();
    });

    it('says so when there are no keys', async () => {
        listAPIKeys.mockResolvedValue({ keys: [] });
        render(<ApiKeysCard />);

        expect(await screen.findByText(/No keys yet/)).toBeInTheDocument();
    });

    it('creates a read-only key that never expires and shows its token once', async () => {
        listAPIKeys.mockResolvedValue({ keys: [] });
        createAPIKey.mockResolvedValue({ key: DOORBELL, token: TOKEN });
        render(<ApiKeysCard />);
        const user = setupUser();

        await user.type(await screen.findByLabelText(/New key/), 'Doorbell');
        await user.click(screen.getByRole('button', { name: 'Create key' }));

        await waitFor(() => {
            expect(createAPIKey).toHaveBeenCalledWith({ name: 'Doorbell', scopes: ['view'] });
        });
        expect(await screen.findByText(TOKEN)).toBeInTheDocument();
        expect(screen.getByText(/can never show it again/)).toBeInTheDocument();

        // Dismissed, it is gone for good: nothing else in the console holds it.
        await user.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
    });

    it('sends manage and an expiry when they are chosen', async () => {
        listAPIKeys.mockResolvedValue({ keys: [] });
        createAPIKey.mockResolvedValue({ key: DOORBELL, token: TOKEN });
        render(<ApiKeysCard />);
        const user = setupUser();

        await user.type(await screen.findByLabelText(/New key/), 'Backup');
        await user.click(screen.getByText('Read and manage'));
        await user.click(screen.getByRole('combobox', { name: 'Expires' }));
        await user.click(await screen.findByRole('option', { name: '30 days' }));
        await user.click(screen.getByRole('button', { name: 'Create key' }));

        await waitFor(() => {
            expect(createAPIKey).toHaveBeenCalledOnce();
        });
        const sent = createAPIKey.mock.calls[0]?.[0] as { name: string; scopes: string[]; expiresAt: DateTime };
        expect(sent.scopes).toEqual(['manage']);
        expect(Math.round(sent.expiresAt.diffNow('days').days)).toBe(30);
    });

    it('re-verifies when the API asks for a recent factor, then creates the key', async () => {
        listAPIKeys.mockResolvedValue({ keys: [] });
        createAPIKey.mockRejectedValueOnce(stepUpDenied()).mockResolvedValueOnce({ key: DOORBELL, token: TOKEN });
        startMFAChallenge.mockResolvedValue({
            result: 'mfa_required',
            challenge_id: 'mfa-9',
            factors: [{ method: 'authenticator', method_id: 'totp-1', kind: 'possession', label: 'Phone' }],
        });
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-2', expires_in: 900, token_type: 'Bearer', scope: '' });
        render(<ApiKeysCard />);
        const user = setupUser();

        await user.type(await screen.findByLabelText(/New key/), 'Doorbell');
        await user.click(screen.getByRole('button', { name: 'Create key' }));
        expect(await screen.findByText('Confirm it is you')).toBeInTheDocument();
        await user.type(await screen.findByLabelText('Authenticator code'), '123456');

        expect(await screen.findByText(TOKEN)).toBeInTheDocument();
        expect(createAPIKey).toHaveBeenCalledTimes(2);
    });

    it('revokes a key after asking', async () => {
        listAPIKeys.mockResolvedValue({ keys: [DOORBELL] });
        revokeAPIKey.mockResolvedValue(undefined);
        render(<ApiKeysCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Revoke' }));
        expect(await screen.findByText('Revoke Doorbell?')).toBeInTheDocument();
        await user.click(screen.getAllByRole('button', { name: 'Revoke' }).at(-1)!);

        await waitFor(() => {
            expect(revokeAPIKey).toHaveBeenCalledWith('k-1');
        });
    });

    it('rotates a key and shows the new token', async () => {
        listAPIKeys.mockResolvedValue({ keys: [DOORBELL] });
        rotateAPIKey.mockResolvedValue({ key: DOORBELL, token: TOKEN });
        render(<ApiKeysCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Rotate' }));
        await user.click(screen.getAllByRole('button', { name: 'Rotate' }).at(-1)!);

        expect(await screen.findByText(TOKEN)).toBeInTheDocument();
        expect(rotateAPIKey).toHaveBeenCalledWith('k-1');
        expect(screen.getByText(/old token has stopped working/)).toBeInTheDocument();
    });
});
