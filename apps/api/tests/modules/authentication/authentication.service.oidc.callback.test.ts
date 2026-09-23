// The OIDC callback is where "anyone with an account at the identity provider" could become
// "anyone with an account here". It used to: an unknown identity got an account, with no role, for
// the asking. Now an identity nobody here knows gets an account only when the allowlist names its
// provider-verified address, and gets the listener role and nothing else. Everything else lands the
// browser on the console with a code and a sentence.

import { describe, expect, it, vi } from 'vitest';
import { httpError } from '@maroonedsoftware/errors';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';
import { SIGNIN_KEYS } from '../../../src/modules/authentication/signin.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

const NEW_ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EXISTING_ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Completion =
    | {
          kind: 'signed-in' | 'linked';
          actorId: string;
          factorId: string;
          redirectAfter?: string;
          intent?: 'sign-in' | 'link';
          profile?: { provider: string };
      }
    | { kind: 'new-user'; authorizationId: string; profile: { email?: string; emailVerified?: boolean }; emailConflict?: { actorId: string } };

function build(completion: Completion, allowlist = '') {
    const oidcFactorService = {
        completeAuthorization: vi.fn(async (): Promise<unknown> => ({ intent: 'sign-in', ...completion })),
        createFactorFromAuthorization: vi.fn(async () => ({ id: 'factor-new' })),
        stashAuthenticatedExchange: vi.fn(async () => 'exchange-1'),
    };
    const actorsRepository = { create: vi.fn(async () => ({ id: NEW_ACTOR })) };
    const emailFactorRepository = { createFactor: vi.fn(async () => ({})) };
    const permissionsService = { writeDirect: vi.fn(async () => undefined) };
    const sessionActivity = { recordFactorFailure: vi.fn(async () => undefined) };
    const htmlRedirectProvider = { getRedirectHtml: (url: URL) => ({ html: url.toString() }) };

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, {
        options: { spaBaseUrl: 'https://radio.example' },
        config: settingsConfig({ [SIGNIN_KEYS.allowlist]: allowlist }).config,
        oidcFactorService,
        actorsRepository,
        emailFactorRepository,
        permissionsService,
        sessionActivity,
        htmlRedirectProvider,
    });

    const callback = async () => new URL(await service.handleOidcCallback({ code: 'c', state: 's' }));
    return { callback, oidcFactorService, actorsRepository, emailFactorRepository, permissionsService, sessionActivity };
}

const newcomer = (email: string, emailVerified = true): Completion => ({
    kind: 'new-user',
    authorizationId: 'authz-1',
    profile: { email, emailVerified },
});

describe('AuthenticationService.handleOidcCallback', () => {
    it('signs an identity already linked to an account straight in, whatever the allowlist says', async () => {
        const h = build({ kind: 'signed-in', actorId: EXISTING_ACTOR, factorId: 'factor-1' });

        const target = await h.callback();

        expect(target.searchParams.get('token')).toBe('oidc:exchange-1');
        expect(h.oidcFactorService.stashAuthenticatedExchange).toHaveBeenCalledWith(expect.objectContaining({ actorId: EXISTING_ACTOR }));
        expect(h.actorsRepository.create).not.toHaveBeenCalled();
    });

    it('lands a finished link on Security, naming the provider, without signing anybody in', async () => {
        const h = build({ kind: 'linked', actorId: EXISTING_ACTOR, factorId: 'f', intent: 'link', profile: { provider: 'authelia' } });

        const target = await h.callback();

        expect(target.pathname).toBe('/settings/security');
        expect(target.searchParams.get('linked')).toBe('authelia');
        expect(h.oidcFactorService.stashAuthenticatedExchange).not.toHaveBeenCalled();
    });

    it('sends a link to an identity another account holds back to Security, saying so', async () => {
        const h = build({ kind: 'signed-in', actorId: EXISTING_ACTOR, factorId: 'f' });
        h.oidcFactorService.completeAuthorization.mockRejectedValueOnce(
            httpError(409).withDetails({ provider: 'already linked to another account' }),
        );

        const target = await h.callback();

        expect(target.pathname).toBe('/settings/security');
        expect(target.searchParams.get('link_error')).toBe('already_linked');
    });

    it('always lands on the console callback, carrying the path to return to beside the token', async () => {
        const h = build({ kind: 'signed-in', actorId: EXISTING_ACTOR, factorId: 'factor-1', redirectAfter: '/settings/security' });

        const target = await h.callback();

        expect(target.origin + target.pathname).toBe('https://radio.example/auth/callback');
        expect(target.searchParams.get('redirect')).toBe('/settings/security');
    });

    it('drops a return address that would leave the console', async () => {
        const h = build({ kind: 'signed-in', actorId: EXISTING_ACTOR, factorId: 'factor-1', redirectAfter: 'https://evil.example/' });

        const target = await h.callback();

        expect(target.origin).toBe('https://radio.example');
        expect(target.searchParams.has('redirect')).toBe(false);
    });

    it('turns away a newcomer the allowlist does not name, and creates nothing', async () => {
        const h = build(newcomer('stranger@elsewhere.net'), 'example.com');

        const target = await h.callback();

        expect(target.pathname).toBe('/auth/callback');
        expect(target.searchParams.get('error')).toBe('not_allowed');
        expect(target.searchParams.get('error_description')).toContain('not allowed to join');
        expect(h.actorsRepository.create).not.toHaveBeenCalled();
        expect(h.permissionsService.writeDirect).not.toHaveBeenCalled();
    });

    it('turns away everybody new while the allowlist is empty', async () => {
        const h = build(newcomer('alice@example.com'));
        expect((await h.callback()).searchParams.get('error')).toBe('not_allowed');
    });

    it('does not admit an address the provider has not verified, even one the list names', async () => {
        const h = build(newcomer('alice@example.com', false), 'alice@example.com');
        expect((await h.callback()).searchParams.get('error')).toBe('not_allowed');
        expect(h.actorsRepository.create).not.toHaveBeenCalled();
    });

    it('gives an admitted newcomer an account, their address, the identity, and the listener role', async () => {
        const h = build(newcomer('Alice@Example.com'), 'example.com');

        const target = await h.callback();

        expect(target.searchParams.get('token')).toBe('oidc:exchange-1');
        expect(target.searchParams.get('is_new_user')).toBe('true');
        expect(h.emailFactorRepository.createFactor).toHaveBeenCalledWith(NEW_ACTOR, 'Alice@Example.com');
        expect(h.oidcFactorService.createFactorFromAuthorization).toHaveBeenCalledWith(NEW_ACTOR, 'authz-1');
        expect(h.permissionsService.writeDirect).toHaveBeenCalledWith(
            [
                {
                    object: { namespace: 'platform', id: 'main' },
                    relation: 'listener',
                    subject: { kind: 'concrete', namespace: 'user', id: NEW_ACTOR },
                },
            ],
            NEW_ACTOR,
        );
    });

    it('refuses to shadow an existing account whose address the provider did not verify', async () => {
        const h = build({ ...newcomer('alice@example.com', false), emailConflict: { actorId: EXISTING_ACTOR } } as Completion, 'example.com');

        const target = await h.callback();

        expect(target.searchParams.get('error')).toBe('email_unverified');
        expect(h.actorsRepository.create).not.toHaveBeenCalled();
    });

    it('sends a generic sentence rather than an exception message when the exchange itself fails', async () => {
        const h = build(newcomer('alice@example.com'));
        h.oidcFactorService.completeAuthorization.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.4:443'));

        const target = await h.callback();

        expect(target.searchParams.get('error')).toBe('oidc_failed');
        expect(target.toString()).not.toContain('ECONNREFUSED');
        expect(h.sessionActivity.recordFactorFailure).toHaveBeenCalledWith(expect.objectContaining({ lastReason: 'ECONNREFUSED 10.0.0.4:443' }));
    });
});

describe('AuthenticationService.listOidcProviders', () => {
    it('offers each usable provider by name and button, and never a secret', async () => {
        const rows = [
            { $id: 'r1', name: 'authelia', label: 'Authelia', issuer: 'https://auth.example.com', clientId: 'x' },
            { $id: 'r2', name: 'broken', label: 'Broken', issuer: 'not a url', clientId: 'x' },
        ];
        const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
        Object.assign(service, {
            config: settingsConfig({
                [SIGNIN_KEYS.providers]: JSON.stringify(rows),
                ['signin.providers/r1/clientSecret']: 'secret',
            }).config,
        });

        await expect(service.listOidcProviders()).resolves.toEqual([{ name: 'authelia', label: 'Authelia' }]);
    });
});
