// Builds AuthenticationModule's real registrations through injectkit's verified `build()`, because the
// OIDC registry is wired by TOKEN and a wrong token compiles. Since @maroonedsoftware/authentication 6
// the registry asks for an `OidcProviderSource`; registering the static config under its own class
// type-checks, passes every unit test that constructs the registry by hand, and stops the server at
// boot with "Missing dependencies for OidcProviderRegistry". This is the one place that notices first.
//
// It also proves the providers really do come from the console's list, read live: a row stored after
// the container was built is the next lookup's answer, with its secret decrypted on the way.

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InjectKitRegistry, type Identifier } from 'injectkit';
import { Kysely } from 'kysely';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitContext } from '@maroonedsoftware/koa';
import { CacheProvider } from '@maroonedsoftware/cache';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { PolicyService } from '@maroonedsoftware/policies';
import { OidcProviderRegistry } from '@maroonedsoftware/authentication';
import { ROW_ID_KEY, rowSecretKey } from '@deadair/plugin-sdk';

import { AuthenticationModule } from '../../../src/modules/authentication/authentication.module.js';
import { MailService } from '../../../src/modules/mail/mail.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { DeadairPermissionsTupleRepository } from '../../../src/modules/permissions/permissions.repository.js';
import { SIGNIN_KEYS } from '../../../src/modules/authentication/signin.settings.js';
import { settingsConfig } from '../../utils/settings.config.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SESSION_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

// Registered by modules this one depends on at request time. Stood in for by value so the build
// verifies AuthenticationModule's own graph, which is the thing under test; nothing here resolves them.
const FOREIGN: Identifier<unknown>[] = [
    Kysely,
    DeadairPermissionsTupleRepository,
    CacheProvider,
    PolicyService,
    AuthorizationContext,
    MailService,
    PermissionsService,
    ServerKitContext,
];

const encryption = new EncryptionProvider(randomBytes(32));

const AUTHELIA = JSON.stringify([
    { [ROW_ID_KEY]: 'r1', name: 'authelia', label: 'Authelia', issuer: 'https://auth.example.com', clientId: 'deadair' },
]);

const registryFor = async (values: Record<string, string> = {}) => {
    const station = settingsConfig({ AUTHENTICATION_SESSION_JWT_PRIVATE_KEY: SESSION_KEY, APP_BASE_URL: 'https://radio.example', ...values });
    const registry = new InjectKitRegistry();
    registry.register(Logger).useInstance(logger);
    registry.register(AppConfig).useInstance(station.config);
    const setup = AuthenticationModule.setup;
    if (!setup) throw new Error('AuthenticationModule has no setup hook');
    await setup(registry, station.config);
    const overrides = [...FOREIGN.map(token => ({ token, useValue: {} })), { token: EncryptionProvider, useValue: encryption }];
    return { providers: registry.build({ overrides }).get(OidcProviderRegistry), station };
};

describe('AuthenticationModule OIDC wiring', () => {
    it('resolves the provider registry through the settings source', async () => {
        const { providers } = await registryFor({
            [SIGNIN_KEYS.providers]: AUTHELIA,
            [rowSecretKey(SIGNIN_KEYS.providers, 'r1', 'clientSecret')]: encryption.encrypt('shh'),
        });

        expect(await providers.listProviders()).toEqual(['authelia']);
        expect(await providers.getConfig('authelia')).toMatchObject({
            clientSecret: 'shh',
            redirectUri: new URL('https://radio.example/api/auth/login/oidc/callback'),
        });
    });

    it('no longer reads the Google variables directly: those are copied into the list at start', async () => {
        const { providers } = await registryFor({ GOOGLE_OIDC_CLIENT_ID: 'id', GOOGLE_OIDC_CLIENT_SECRET: 'secret' });
        expect(await providers.listProviders()).toEqual([]);
    });

    it('answers a provider stored after the container was built', async () => {
        const { providers, station } = await registryFor();
        expect(await providers.listProviders()).toEqual([]);

        station.set(SIGNIN_KEYS.providers, AUTHELIA);

        expect(await providers.listProviders()).toEqual(['authelia']);
    });
});
