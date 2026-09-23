import { Registry } from 'injectkit';
import { Duration } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ServerKitModule } from '@maroonedsoftware/koa';
import {
    AuthorizationCodeService,
    AuthorizationCodeServiceOptions,
    AuthorizationRequestStore,
    AuthorizationRequestStoreOptions,
    ClientIdMetadataDocumentResolver,
    ClientIdMetadataDocumentResolverOptions,
    DynamicClientRegistrationService,
    OAuthAuthorizationServer,
    OAuthAuthorizationServerOptions,
    OAuthClientOptions,
    OAuthClientRepository,
    OAuthClientResolver,
    OAuthGrantRepository,
    OAuthTokenEndpoint,
} from '@maroonedsoftware/authentication';
import { OAuthOptions } from './oauth.options.js';
import { clientMetadataHostAllowed, dynamicRegistrationIsOn } from './oauth.settings.js';
import { DeadairOAuthClientRepository } from './repositories/oauth.client.repository.js';
import { DeadairOAuthGrantRepository } from './repositories/oauth.grant.repository.js';

/** The scope an MCP client is offered. Nothing authorizes on it: a grant is the whole user session. */
export const OAUTH_SCOPES: readonly string[] = ['mcp'];

/**
 * How long a token an app holds lasts before it has to be refreshed, and so how long a grant's
 * session lives without use. Shorter than a console session's thirty days, because an app refreshes
 * on its own and a person revoking one should not be relying on the refresh to notice.
 */
export const OAUTH_SESSION_LIFETIME = Duration.fromObject({ days: 7 });

/**
 * The station as an OAuth 2.1 authorization server, wired as `@maroonedsoftware/authentication`'s
 * README lays it out: the library owns the flow and this module supplies the stores, the addresses
 * and the switches.
 *
 * The switches are live settings, and the library's options are fixed objects, so the options that
 * carry one are SCOPED factories read per request: `registrationEndpoint` is present only while
 * `oauth.dynamicRegistration` is on, which is how the library knows to refuse a registration and
 * leave it out of its metadata. The metadata-document host allowlist is a function that reads its
 * setting each time. `oauth.enabled` itself is checked by the routes and the MCP policy, which
 * answer as though none of this existed while it is off.
 *
 * Registered only on a station with a public address: without `APP_BASE_URL` there is no issuer,
 * and the routes answer 404.
 */
export const OAuthModule: ServerKitModule = {
    name: 'OAuth',
    setup: async (registry: Registry, config: AppConfig) => {
        const oauth = OAuthOptions.fromConfig(config);

        registry.register(DeadairOAuthClientRepository).useClass(DeadairOAuthClientRepository).asScoped();
        registry.register(DeadairOAuthGrantRepository).useClass(DeadairOAuthGrantRepository).asScoped();
        registry
            .register(OAuthClientRepository)
            .useFactory(container => container.get(DeadairOAuthClientRepository))
            .asScoped();
        registry
            .register(OAuthGrantRepository)
            .useFactory(container => container.get(DeadairOAuthGrantRepository))
            .asScoped();

        // Everything that holds the Redis cache is scoped, because the cache is: a singleton would
        // capture one scope's instance, and the build refuses it. They keep nothing between requests
        // of their own, so nothing is lost; the cache itself is what persists.
        registry.register(OAuthClientOptions).useInstance(new OAuthClientOptions());
        registry
            .register(ClientIdMetadataDocumentResolverOptions)
            .useInstance(
                new ClientIdMetadataDocumentResolverOptions(undefined, undefined, undefined, undefined, undefined, host =>
                    clientMetadataHostAllowed(config, host),
                ),
            );
        registry.register(ClientIdMetadataDocumentResolver).useClass(ClientIdMetadataDocumentResolver).asScoped();
        registry.register(OAuthClientResolver).useClass(OAuthClientResolver).asScoped();
        registry.register(DynamicClientRegistrationService).useClass(DynamicClientRegistrationService).asScoped();
        registry.register(AuthorizationRequestStoreOptions).useInstance(new AuthorizationRequestStoreOptions());
        registry.register(AuthorizationRequestStore).useClass(AuthorizationRequestStore).asScoped();
        registry.register(AuthorizationCodeServiceOptions).useInstance(new AuthorizationCodeServiceOptions());
        registry.register(AuthorizationCodeService).useClass(AuthorizationCodeService).asScoped();

        if (oauth === undefined) return;
        registry.register(OAuthOptions).useInstance(oauth);
        registry
            .register(OAuthAuthorizationServerOptions)
            .useFactory(
                () =>
                    new OAuthAuthorizationServerOptions(
                        oauth.issuer,
                        oauth.authorizationEndpoint,
                        oauth.tokenEndpoint,
                        [oauth.resource],
                        OAUTH_SCOPES,
                        dynamicRegistrationIsOn(config) ? oauth.registrationEndpoint : undefined,
                        OAUTH_SESSION_LIFETIME,
                    ),
            )
            .asScoped();
        // Both reach the session service, which is scoped.
        registry.register(OAuthTokenEndpoint).useClass(OAuthTokenEndpoint).asScoped();
        registry.register(OAuthAuthorizationServer).useClass(OAuthAuthorizationServer).asScoped();
    },
};
