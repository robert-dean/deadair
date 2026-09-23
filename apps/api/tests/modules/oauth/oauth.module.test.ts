// The OAuth module wired for real: AuthenticationModule and OAuthModule set up into one registry and
// built through injectkit's verified `build()`, which refuses a missing dependency and a singleton
// that captures a scoped one. The library's pieces are registered by token and some by factory, so
// this is where a wiring mistake surfaces rather than at the first request somebody makes.

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InjectKitRegistry, type Identifier } from 'injectkit';
import { Kysely } from 'kysely';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { CacheProvider } from '@maroonedsoftware/cache';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { ServerKitContext } from '@maroonedsoftware/koa';
import { Logger } from '@maroonedsoftware/logger';
import { PolicyService } from '@maroonedsoftware/policies';
import { OAuthAuthorizationServer } from '@maroonedsoftware/authentication';

import { AuthenticationModule } from '../../../src/modules/authentication/authentication.module.js';
import { OAuthModule } from '../../../src/modules/oauth/oauth.module.js';
import { MailService } from '../../../src/modules/mail/mail.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { DeadairPermissionsTupleRepository } from '../../../src/modules/permissions/permissions.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SESSION_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

/**
 * Stands in for the Redis cache with the lifetime the real one has. SCOPED, which matters: a
 * singleton holding the cache is a captive dependency the build refuses, and a stand-in registered
 * as a value would hide exactly that.
 */
class ScopedCache {}

// Registered by modules these depend on at request time; stood in for so the build verifies these two.
const FOREIGN: Identifier<unknown>[] = [
    Kysely,
    DeadairPermissionsTupleRepository,
    PolicyService,
    AuthorizationContext,
    MailService,
    PermissionsService,
    ServerKitContext,
];

async function serverFor(values: Record<string, string>) {
    const station = settingsConfig({ AUTHENTICATION_SESSION_JWT_PRIVATE_KEY: SESSION_KEY, ...values });
    const registry = new InjectKitRegistry();
    registry.register(Logger).useInstance(logger);
    registry.register(AppConfig).useInstance(station.config);
    for (const module of [AuthenticationModule, OAuthModule]) await module.setup?.(registry, station.config);
    const overrides = [
        ...FOREIGN.map(token => ({ token, useValue: {} })),
        { token: EncryptionProvider, useValue: new EncryptionProvider(randomBytes(32)) },
        { token: CacheProvider, useClass: ScopedCache as never, lifetime: 'scoped' as const },
    ];
    const container = registry.build({ overrides });
    return { server: () => container.createScopedContainer().get(OAuthAuthorizationServer), station };
}

describe('OAuthModule', () => {
    it('builds, and publishes the station as its own issuer', async () => {
        const { server } = await serverFor({ APP_BASE_URL: 'https://radio.example.com' });

        expect(server().metadata()).toMatchObject({
            issuer: 'https://radio.example.com',
            authorization_endpoint: 'https://radio.example.com/oauth/authorize',
            token_endpoint: 'https://radio.example.com/api/auth/oauth/token',
            registration_endpoint: 'https://radio.example.com/api/auth/oauth/register',
            code_challenge_methods_supported: ['S256'],
            client_id_metadata_document_supported: true,
        });
        expect(server().resourceMetadata('https://radio.example.com/api/mcp')).toMatchObject({
            resource: 'https://radio.example.com/api/mcp',
            authorization_servers: ['https://radio.example.com'],
        });
    });

    it('stops offering registration the moment it is switched off, with no restart', async () => {
        const { server, station } = await serverFor({ APP_BASE_URL: 'https://radio.example.com' });
        expect(server().registrationEnabled).toBe(true);

        station.set('oauth.dynamicRegistration', 'false');

        expect(server().registrationEnabled).toBe(false);
        expect(server().metadata()).not.toHaveProperty('registration_endpoint');
    });
});
