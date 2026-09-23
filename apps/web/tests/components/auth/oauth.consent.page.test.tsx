// The consent page: an app asks to act as the signed-in person, and they answer. What matters is
// that the answer goes to the app, that a refused request is never followed anywhere, that the page
// says who receives the answer, and that an app only ever sent back to this computer is flagged.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OAuthConsentPage } from '../../../src/components/auth/oauth.consent.page';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const describeAuthorizationRequest = vi.fn();
const approveAuthorizationRequest = vi.fn();
const denyAuthorizationRequest = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        oauth: {
            describeAuthorizationRequest: (...args: unknown[]) => describeAuthorizationRequest(...args),
            approveAuthorizationRequest: (...args: unknown[]) => approveAuthorizationRequest(...args),
            denyAuthorizationRequest: (...args: unknown[]) => denyAuthorizationRequest(...args),
        },
        authentication: { factors: { startMFAChallenge: vi.fn() } },
    },
}));

afterEach(() => {
    for (const mock of [describeAuthorizationRequest, approveAuthorizationRequest, denyAuthorizationRequest]) mock.mockReset();
});

const CONTEXT = {
    kind: 'context',
    requestId: 'req-1',
    clientId: 'dyn_1',
    clientKind: 'dynamic',
    clientName: 'Claude',
    redirectHost: 'claude.ai',
    loopbackOnly: false,
    scope: ['mcp'],
    resource: 'https://radio.example.com/api/mcp',
};

const QUERY = '?client_id=dyn_1&state=abc';

describe('OAuthConsentPage', () => {
    it('sends the query as the app sent it, and says who is asking and who receives the answer', async () => {
        describeAuthorizationRequest.mockResolvedValue(CONTEXT);
        render(<OAuthConsentPage query={QUERY} leave={vi.fn()} />);

        expect(await screen.findByText('Claude wants to connect to this station as you')).toBeInTheDocument();
        expect(screen.getByText('claude.ai')).toBeInTheDocument();
        expect(describeAuthorizationRequest).toHaveBeenCalledWith({ query: QUERY });
        expect(screen.queryByText('An app on this computer')).not.toBeInTheDocument();
    });

    it('warns about an app only ever sent back to this computer', async () => {
        describeAuthorizationRequest.mockResolvedValue({ ...CONTEXT, clientName: 'Claude Code', redirectHost: 'localhost', loopbackOnly: true });
        render(<OAuthConsentPage query={QUERY} leave={vi.fn()} />);

        expect(await screen.findByText('An app on this computer')).toBeInTheDocument();
    });

    it('allowing sends the browser to the app with its code', async () => {
        const leave = vi.fn();
        describeAuthorizationRequest.mockResolvedValue(CONTEXT);
        approveAuthorizationRequest.mockResolvedValue({ redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=c&state=abc' });
        render(<OAuthConsentPage query={QUERY} leave={leave} />);

        await setupUser().click(await screen.findByRole('button', { name: 'Allow' }));

        await waitFor(() => expect(leave).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=abc'));
        expect(approveAuthorizationRequest).toHaveBeenCalledWith({ requestId: 'req-1' });
    });

    it('denying sends the browser to the app with the refusal', async () => {
        const leave = vi.fn();
        describeAuthorizationRequest.mockResolvedValue(CONTEXT);
        denyAuthorizationRequest.mockResolvedValue({ redirectUrl: 'https://claude.ai/api/mcp/auth_callback?error=access_denied' });
        render(<OAuthConsentPage query={QUERY} leave={leave} />);

        await setupUser().click(await screen.findByRole('button', { name: 'Deny' }));

        await waitFor(() => expect(leave).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?error=access_denied'));
        expect(approveAuthorizationRequest).not.toHaveBeenCalled();
    });

    it('sends a request the app got wrong straight back to it', async () => {
        const leave = vi.fn();
        describeAuthorizationRequest.mockResolvedValue({ kind: 'redirect', redirectUrl: 'https://claude.ai/cb?error=invalid_scope' });
        render(<OAuthConsentPage query={QUERY} leave={leave} />);

        await waitFor(() => expect(leave).toHaveBeenCalledWith('https://claude.ai/cb?error=invalid_scope'));
    });

    it('shows a refused request and follows it nowhere', async () => {
        const leave = vi.fn();
        describeAuthorizationRequest.mockResolvedValue({ kind: 'refuse', error: 'invalid_client', description: 'client_id names no client' });
        render(<OAuthConsentPage query={QUERY} leave={leave} />);

        expect(await screen.findByText('client_id names no client')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
        expect(leave).not.toHaveBeenCalled();
    });
});
