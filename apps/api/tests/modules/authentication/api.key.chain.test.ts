// The bearer scheme carries two credentials, and the order the chain tries them in is a cost
// decision: the key handler declines a JWT on its prefix with no I/O, so it goes first. These pin
// that with the station's own prefix and ServerKit's real handlers, which is the wiring
// `authentication.module.ts` registers.

import { describe, expect, it, vi } from 'vitest';
import {
    ApiKeyAuthenticationHandler,
    ApiKeyServiceOptions,
    ChainedAuthenticationHandler,
    invalidAuthenticationSession,
    type ApiKeyService,
    type AuthenticationHandler,
    type AuthenticationSession,
} from '@maroonedsoftware/authentication';

import { API_KEY_PREFIX, API_KEY_USE_WINDOW } from '../../../src/modules/authentication/api.key.options.js';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.signature';
const KEY = `${API_KEY_PREFIX}_0123456789abcdefghijABCDEFGHIJ0123456789abcDEFxyz123`;

const keySession = { subject: 'u-1', claims: { apiKey: { id: 'k-1' } } } as unknown as AuthenticationSession;
const jwtSession = { subject: 'u-1', claims: { actorType: 'user' } } as unknown as AuthenticationSession;

const chainWith = (keyResult: AuthenticationSession, jwtResult: AuthenticationSession) => {
    const service = { authenticate: vi.fn().mockResolvedValue(keyResult) };
    const jwt: AuthenticationHandler = { authenticate: vi.fn().mockResolvedValue(jwtResult) };
    const options = new ApiKeyServiceOptions(API_KEY_PREFIX, 32, undefined, undefined, API_KEY_USE_WINDOW);
    const keyHandler = new ApiKeyAuthenticationHandler(options, service as unknown as ApiKeyService);
    const chain = new ChainedAuthenticationHandler([keyHandler, jwt] as never);
    return { chain, service, jwt };
};

describe('the bearer chain', () => {
    it('declines a JWT at the key handler without asking the key service', async () => {
        const { chain, service, jwt } = chainWith(invalidAuthenticationSession, jwtSession);

        await expect(chain.authenticate('bearer', JWT)).resolves.toBe(jwtSession);
        expect(service.authenticate).not.toHaveBeenCalled();
        expect(jwt.authenticate).toHaveBeenCalledOnce();
    });

    it('answers a valid key without reaching the JWT handler', async () => {
        const { chain, service, jwt } = chainWith(keySession, jwtSession);

        await expect(chain.authenticate('bearer', KEY)).resolves.toBe(keySession);
        expect(service.authenticate).toHaveBeenCalledWith(KEY);
        expect(jwt.authenticate).not.toHaveBeenCalled();
    });

    it('lets a key that does not validate fall through, where the JWT handler declines it too', async () => {
        // Not "never reached": a bad `da_` token costs the JWT handler a decode that answers null.
        const { chain, jwt } = chainWith(invalidAuthenticationSession, invalidAuthenticationSession);

        await expect(chain.authenticate('bearer', KEY)).resolves.toBe(invalidAuthenticationSession);
        expect(jwt.authenticate).toHaveBeenCalledOnce();
    });

    it('answers only to the bearer scheme', async () => {
        const { chain, service } = chainWith(keySession, invalidAuthenticationSession);

        await expect(chain.authenticate('apikey', KEY)).resolves.toBe(invalidAuthenticationSession);
        expect(service.authenticate).not.toHaveBeenCalled();
    });
});
