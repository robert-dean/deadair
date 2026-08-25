import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { StreamAuthorizationCard } from '../../../src/components/plugins/stream.authorization.card';
import { pluginDetail } from '../../utils/plugin.fixture';
import { render, screen, setupUser } from '../../utils/render';

const readFetcherAuthorization = vi.fn();
const startFetcherAuthorization = vi.fn();
const finishFetcherAuthorization = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        stream: {
            readFetcherAuthorization: (...args: unknown[]) => readFetcherAuthorization(...args),
            startFetcherAuthorization: (...args: unknown[]) => startFetcherAuthorization(...args),
            finishFetcherAuthorization: (...args: unknown[]) => finishFetcherAuthorization(...args),
        },
    },
}));

const spotify = pluginDetail({ capabilities: ['catalog', 'stream', 'oauth'] });

/** What the fetcher says when it is running but has never been authorized: the state this exists for. */
const unauthorized = {
    reachable: true,
    configured: true,
    authorized: false,
    session: false,
    loginError: 'failed authenticating with login5: INVALID_CREDENTIALS',
    callbackUrl: 'http://127.0.0.1:3679/login',
};

afterEach(() => {
    readFetcherAuthorization.mockReset();
    startFetcherAuthorization.mockReset();
    finishFetcherAuthorization.mockReset();
});

describe('StreamAuthorizationCard', () => {
    it('says the station cannot fetch audio, and shows why the login was refused', async () => {
        readFetcherAuthorization.mockResolvedValue(unauthorized);

        render(<StreamAuthorizationCard plugin={spotify} />);

        expect(await screen.findByText('The station cannot fetch any audio yet')).toBeInTheDocument();
        expect(screen.getByText(unauthorized.loginError)).toBeInTheDocument();
        expect(screen.getByText('Not authorized')).toBeInTheDocument();
    });

    // The two states that must never collapse into one. "Authorize Spotify" is useless advice to
    // somebody whose fetcher is not running, and it is the advice a card that read these as one
    // fact would give.
    it('tells a fetcher that is not answering from one that was never authorized', async () => {
        readFetcherAuthorization.mockResolvedValue({ reachable: false, configured: true, authorized: false, session: false });

        render(<StreamAuthorizationCard plugin={spotify} />);

        expect(await screen.findByText('The track fetcher is not answering')).toBeInTheDocument();
        expect(screen.queryByText('The station cannot fetch any audio yet')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Authorize' })).toBeDisabled();
    });

    it('says there is nothing to authorize on an install with no stream half', async () => {
        readFetcherAuthorization.mockResolvedValue({ reachable: false, configured: false, authorized: false, session: false });

        render(<StreamAuthorizationCard plugin={spotify} />);

        expect(await screen.findByText('No track fetcher on this install')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Authorize' })).toBeDisabled();
    });

    // The whole point of the card. The page the operator lands on cannot load on any deployment
    // that does not publish the fetcher's port to their own machine, so saying so BEFORE it happens
    // is what stops the expected outcome reading as the failure it looks exactly like.
    it('warns that the callback page will not load, and names the address', async () => {
        readFetcherAuthorization.mockResolvedValue(unauthorized);
        startFetcherAuthorization.mockResolvedValue({ authorizeUrl: 'https://accounts.spotify.com/authorize?x=1', expiresInMs: 900_000 });

        render(<StreamAuthorizationCard plugin={spotify} />);
        await setupUser().click(await screen.findByRole('button', { name: 'Authorize' }));

        expect(await screen.findByText('The page you land on will not load. That is expected')).toBeInTheDocument();
        expect(screen.getByText('http://127.0.0.1:3679/login')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open the Spotify approval page' })).toHaveAttribute(
            'href',
            'https://accounts.spotify.com/authorize?x=1',
        );
    });

    it('relays the pasted address whole and reports which account landed', async () => {
        readFetcherAuthorization.mockResolvedValue(unauthorized);
        startFetcherAuthorization.mockResolvedValue({ authorizeUrl: 'https://accounts.spotify.com/authorize?x=1', expiresInMs: 900_000 });
        finishFetcherAuthorization.mockResolvedValue({ username: 'thestation' });

        const user = setupUser();
        render(<StreamAuthorizationCard plugin={spotify} />);
        await user.click(await screen.findByRole('button', { name: 'Authorize' }));

        const pasted = '  http://127.0.0.1:3679/login?code=the-code&state=the-state  ';
        await user.type(await screen.findByLabelText('The address you were sent to'), pasted.trim());
        await user.click(screen.getByRole('button', { name: 'Finish' }));

        expect(await screen.findByText('The station now fetches as thestation.')).toBeInTheDocument();
        expect(finishFetcherAuthorization).toHaveBeenCalledWith({ redirectUrl: 'http://127.0.0.1:3679/login?code=the-code&state=the-state' });
    });

    // A refused ATTEMPT is the one failure the operator can clear themselves, so it has to say so
    // rather than reading as the station being broken.
    it('tells an operator to start again when the attempt itself is refused', async () => {
        readFetcherAuthorization.mockResolvedValue(unauthorized);
        startFetcherAuthorization.mockResolvedValue({ authorizeUrl: 'https://accounts.spotify.com/authorize?x=1', expiresInMs: 900_000 });
        finishFetcherAuthorization.mockRejectedValue(
            new SdkError(400, 'Bad Request', { statusCode: 400, message: 'no authorization is pending' }, new Headers()),
        );

        const user = setupUser();
        render(<StreamAuthorizationCard plugin={spotify} />);
        await user.click(await screen.findByRole('button', { name: 'Authorize' }));
        await user.type(await screen.findByLabelText('The address you were sent to'), 'http://127.0.0.1:3679/login?code=a&state=b');
        await user.click(screen.getByRole('button', { name: 'Finish' }));

        expect(await screen.findByText(/Start the authorization again and use the new link\./)).toBeInTheDocument();
    });

    it('offers a re-authorization rather than a first one once the station holds a login', async () => {
        readFetcherAuthorization.mockResolvedValue({ reachable: true, configured: true, authorized: true, session: true });

        render(<StreamAuthorizationCard plugin={spotify} />);

        expect(await screen.findByText('Authorized')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Re-authorize' })).toBeEnabled();
    });

    it('asks nothing of the API for a plugin the operator has switched off', async () => {
        render(<StreamAuthorizationCard plugin={pluginDetail({ capabilities: ['catalog', 'stream'], enabled: false })} />);

        expect(await screen.findByText(/Enable Spotify to see whether the station can fetch its audio\./)).toBeInTheDocument();
        expect(readFetcherAuthorization).not.toHaveBeenCalled();
    });
});
