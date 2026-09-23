import type { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Logger } from '@maroonedsoftware/logger';
import { OidcProviderSource, type OidcProviderConfig } from '@maroonedsoftware/authentication';
import { inScope } from '#modules/shared/scoped.work.js';
import { resolveSigninProviders, type SigninProvider } from './signin.settings.js';

/**
 * The identity providers the OIDC registry signs people in through, read from the console's
 * `signin.providers` list on every lookup.
 *
 * The registry consults its source each time it resolves a provider, so a row an operator adds,
 * edits or deletes applies to the next sign-in with no restart, and a rotated client secret
 * rediscovers because the registry keys its discovery cache on the credentials. What this pays per
 * lookup is a settings read and one AES decrypt per row, which is nothing beside the redirect to an
 * identity provider it precedes.
 *
 * A singleton, because the registry that holds it is one. `EncryptionProvider` is scoped, so a
 * decrypt opens a scope of its own from the ROOT container rather than capturing one, which
 * InjectKit would refuse at `build()` anyway (see `shared/scoped.work.ts`).
 */
export class SettingsOidcProviderSource extends OidcProviderSource {
    /** Each resolver warning once per process, since every lookup re-reads the same rows. */
    private readonly warned = new Set<string>();

    constructor(
        private readonly config: AppConfig,
        private readonly container: Container,
        private readonly logger: Logger,
        private readonly redirectUri: (config: AppConfig) => URL,
    ) {
        super();
    }

    async list(): Promise<OidcProviderConfig[]> {
        const providers = await inScope(this.container, async scope => {
            const encryption = scope.get(EncryptionProvider);
            return resolveSigninProviders(
                this.config,
                ciphertext => encryption.decrypt(ciphertext),
                message => this.warnOnce(message),
            );
        });
        // Only with a provider to send anybody to: the redirect needs `APP_BASE_URL`, and a station
        // without one that offers no provider must still answer "none" rather than throw.
        if (providers.length === 0) return [];
        const redirectUri = this.redirectUri(this.config);
        return providers.map(provider => toOidcProviderConfig(provider, redirectUri));
    }

    private warnOnce(message: string): void {
        if (this.warned.has(message)) return;
        this.warned.add(message);
        this.logger.warn(message);
    }
}

/**
 * A console row as the library's provider config. An `http:` issuer is allowed only because it
 * says so itself, which is the dev mock IdP; the library still logs a warning for it.
 */
export function toOidcProviderConfig(provider: SigninProvider, redirectUri: URL): OidcProviderConfig {
    return {
        name: provider.name,
        issuer: provider.issuer,
        clientId: provider.clientId,
        ...(provider.clientSecret === undefined ? {} : { clientSecret: provider.clientSecret }),
        scopes: provider.scopes,
        redirectUri,
        ...(provider.authorizeParams === undefined ? {} : { authorizeParams: provider.authorizeParams }),
        allowInsecureIssuer: provider.issuer.protocol === 'http:',
    };
}
