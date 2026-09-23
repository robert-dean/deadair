// The settings page's answer to "will these providers work", asked before anybody tries to sign in
// through one. What matters: it asks through the registry a sign-in uses, it reports a failure as a
// sentence naming the real cause rather than "fetch failed", and a row the resolver drops before
// anybody is asked is reported too, since its button simply never appears.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OidcProviderRegistry } from '@maroonedsoftware/authentication';
import { ROW_ID_KEY } from '@deadair/plugin-sdk';

import { problemOf, SIGNIN_CHECK_TIMEOUT_MS, SigninProviderCheckService } from '../../../src/modules/authentication/signin.provider.check.service.js';
import { SIGNIN_KEYS } from '../../../src/modules/authentication/signin.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

const GOOGLE = { [ROW_ID_KEY]: 'r1', name: 'google', label: 'Google', issuer: 'https://accounts.google.com', clientId: 'deadair' };
const KEYCLOAK = {
    [ROW_ID_KEY]: 'r2',
    name: 'keycloak',
    label: 'Keycloak',
    issuer: 'https://auth.example.com/realms/your-realm',
    clientId: 'deadair',
};

function service(rows: Record<string, string>[], getConfiguration: (name: string) => Promise<unknown>) {
    const { config } = settingsConfig({ [SIGNIN_KEYS.providers]: JSON.stringify(rows) });
    const registry = { getConfiguration: vi.fn(getConfiguration) };
    return { check: new SigninProviderCheckService(config, registry as unknown as OidcProviderRegistry), registry };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('SigninProviderCheckService', () => {
    it('asks the registry for each provider, which is the discovery a sign-in runs', async () => {
        const { check, registry } = service([GOOGLE, KEYCLOAK], async () => ({}));

        const result = await check.check();

        expect(registry.getConfiguration.mock.calls.map(([name]) => name)).toEqual(['google', 'keycloak']);
        expect(result.providers).toEqual([
            { name: 'google', label: 'Google', issuer: 'https://accounts.google.com/', ok: true },
            { name: 'keycloak', label: 'Keycloak', issuer: 'https://auth.example.com/realms/your-realm', ok: true },
        ]);
        expect(result.unusable).toEqual([]);
    });

    it('says why a provider did not answer, in words rather than an error code', async () => {
        const refused = new TypeError('fetch failed', {
            cause: Object.assign(new Error('getaddrinfo ENOTFOUND auth.example.com'), { code: 'ENOTFOUND', hostname: 'auth.example.com' }),
        });
        const { check } = service([GOOGLE, KEYCLOAK], async name => {
            if (name === 'keycloak') throw refused;
            return {};
        });

        const [google, keycloak] = (await check.check()).providers;

        expect(google?.ok).toBe(true);
        expect(keycloak).toMatchObject({ ok: false, problem: 'There is no server at auth.example.com.' });
    });

    it('gives up on an issuer that never answers, rather than holding the page', async () => {
        vi.useFakeTimers();
        const { check } = service([GOOGLE], () => new Promise(() => {}));

        const pending = check.check();
        await vi.advanceTimersByTimeAsync(SIGNIN_CHECK_TIMEOUT_MS);

        expect((await pending).providers[0]).toMatchObject({ ok: false, problem: `No answer within ${SIGNIN_CHECK_TIMEOUT_MS / 1000} seconds.` });
    });

    it('reports a row the station drops before asking anybody, which is a button that never appears', async () => {
        // A preset added and never finished: no client id yet.
        const { check, registry } = service([{ ...KEYCLOAK, clientId: '' }], async () => ({}));

        const result = await check.check();

        expect(registry.getConfiguration).not.toHaveBeenCalled();
        expect(result.providers).toEqual([]);
        expect(result.unusable).toEqual(['Provider "keycloak" is skipped because its button, issuer or client id is missing or not usable.']);
    });

    it('answers nothing for a station with no providers', async () => {
        const { check } = service([], async () => ({}));

        expect(await check.check()).toEqual({ providers: [], unusable: [] });
    });
});

describe('problemOf', () => {
    it('gives the status for an issuer that answered, which the library leaves out', () => {
        // How a wrong path under a real host arrives, measured against accounts.google.com.
        const error = new Error('unexpected HTTP response status code', { cause: new Response('', { status: 404 }) });

        expect(problemOf(error)).toBe('It answered 404 when asked for its discovery document, so the issuer address is probably not quite right.');
    });

    it('says a refused connection in words', () => {
        const error = new TypeError('fetch failed', {
            cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', hostname: 'auth.lan' }),
        });

        expect(problemOf(error)).toBe('auth.lan refused the connection.');
    });

    it('otherwise uses the most specific message in the chain', () => {
        expect(problemOf(new Error('outer', { cause: new Error('unexpected "issuer" response parameter value') }))).toBe(
            'unexpected "issuer" response parameter value',
        );
    });

    it('keeps a long answer to a length the page can hold', () => {
        expect(problemOf(new Error('x'.repeat(1000)))).toHaveLength(300);
    });

    it('says something for a failure that is not an Error at all', () => {
        expect(problemOf('nope')).toBe('It did not answer as an OpenID provider.');
    });
});
