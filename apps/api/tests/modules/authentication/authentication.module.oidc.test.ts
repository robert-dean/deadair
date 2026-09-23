// Builds AuthenticationModule's real registrations through injectkit's verified `build()`, because the
// OIDC registry is wired by TOKEN and a wrong token compiles. Since @maroonedsoftware/authentication 6
// the registry asks for an `OidcProviderSource`; registering the static config under its own class
// type-checks, passes every unit test that constructs the registry by hand, and stops the server at
// boot with "Missing dependencies for OidcProviderRegistry". This is the one place that notices first.

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InjectKitRegistry, type Identifier } from 'injectkit';
import { Kysely } from 'kysely';
import { Logger } from '@maroonedsoftware/logger';
import { CacheProvider } from '@maroonedsoftware/cache';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { PolicyService } from '@maroonedsoftware/policies';
import { OidcProviderRegistry } from '@maroonedsoftware/authentication';

import { AuthenticationModule } from '../../../src/modules/authentication/authentication.module.js';
import { MailService } from '../../../src/modules/mail/mail.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { DeadairPermissionsTupleRepository } from '../../../src/modules/permissions/permissions.repository.js';
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
    EncryptionProvider,
    MailService,
];

const registryFor = async (values: Record<string, string>) => {
    const registry = new InjectKitRegistry();
    registry.register(Logger).useInstance(logger);
    const setup = AuthenticationModule.setup;
    if (!setup) throw new Error('AuthenticationModule has no setup hook');
    await setup(
        registry,
        settingsConfig({ AUTHENTICATION_SESSION_JWT_PRIVATE_KEY: SESSION_KEY, APP_BASE_URL: 'https://radio.example', ...values }).config,
    );
    return registry.build({ overrides: FOREIGN.map(token => ({ token, useValue: {} })) }).get(OidcProviderRegistry);
};

describe('AuthenticationModule OIDC wiring', () => {
    it('resolves the provider registry through its source', async () => {
        const providers = await registryFor({ GOOGLE_OIDC_CLIENT_ID: 'id', GOOGLE_OIDC_CLIENT_SECRET: 'secret' });
        expect(await providers.listProviders()).toEqual(['google']);
    });

    it('lists no provider when the Google credentials are not both set', async () => {
        const providers = await registryFor({ GOOGLE_OIDC_CLIENT_ID: 'id' });
        expect(await providers.listProviders()).toEqual([]);
    });
});
