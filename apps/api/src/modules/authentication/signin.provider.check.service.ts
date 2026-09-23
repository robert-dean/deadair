import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { OidcProviderRegistry } from '@maroonedsoftware/authentication';
import type { SigninProviderCheck, SigninProvidersCheck } from '#modules/settings/types/settings.types.js';
import { resolveSigninProviders } from './signin.settings.js';

/** How long one issuer gets to answer before the check says it did not. */
export const SIGNIN_CHECK_TIMEOUT_MS = 10_000;

/**
 * Whether each identity provider in the sign-in settings answers as one, asked from the settings page.
 *
 * Without this a mistyped issuer, or a preset's `auth.example.com` left in place, surfaces as a
 * failed sign-in: somebody presses "Continue with Keycloak" and lands on an error, and the settings
 * page that caused it still looks fine. The check asks through {@link OidcProviderRegistry}, the
 * same discovery a sign-in runs, rather than fetching the discovery document a second way, so a
 * provider it passes is one the sign-in page will reach. A success is cached there exactly as a
 * sign-in's would be, keyed on the issuer and credentials, so changing a row asks again.
 *
 * Rows the resolver drops before anybody is asked (a name that is not a slug, a missing client id)
 * are reported too, in the resolver's own words, because those are the rows whose button simply
 * never appears, which is the failure an operator has the least chance of noticing.
 */
@Injectable()
export class SigninProviderCheckService {
    constructor(
        private readonly config: AppConfig,
        private readonly registry: OidcProviderRegistry,
    ) {}

    async check(): Promise<SigninProvidersCheck> {
        const unusable: string[] = [];
        // No secret is decrypted here: the resolver is asked only for which rows it keeps and why it
        // drops the rest, and the registry reads its own copy of the credentials for discovery.
        const providers = resolveSigninProviders(
            this.config,
            () => '',
            message => unusable.push(sentenceOf(message)),
        );

        const checks = await Promise.all(
            providers.map(async (provider): Promise<SigninProviderCheck> => {
                const asked = { name: provider.name, label: provider.label, issuer: provider.issuer.href };
                try {
                    await withTimeout(this.registry.getConfiguration(provider.name), SIGNIN_CHECK_TIMEOUT_MS);
                    return { ...asked, ok: true };
                } catch (error) {
                    return { ...asked, ok: false, problem: problemOf(error) };
                }
            }),
        );

        return { providers: checks, unusable };
    }
}

/** A resolver warning as a sentence for the page: without its log prefix, and capitalised. */
function sentenceOf(message: string): string {
    const bare = message.replace(/^sign-in:\s*/, '');
    return `${bare.charAt(0).toUpperCase()}${bare.slice(1)}.`;
}

/**
 * Why discovery failed, in a sentence an operator can act on.
 *
 * `openid-client` and `fetch` both put the useful half in `cause`: "fetch failed" says nothing, and
 * its cause's `ENOTFOUND` says the host does not exist. So the chain is walked, the two failures an
 * operator most often causes (a host that is not there, an issuer path that is wrong) are said in
 * words, and anything else is the most specific message in the chain. Measured against real issuers:
 * a wrong path under a real host arrives as "unexpected HTTP response status code" with the
 * `Response` as its cause, which is useless without the status. Capped, because some servers answer
 * with a page of HTML.
 */
export function problemOf(error: unknown): string {
    const messages: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
        if (current instanceof Response) {
            return `It answered ${current.status} when asked for its discovery document, so the issuer address is probably not quite right.`;
        }
        if (!(current instanceof Error)) break;

        const { code, hostname } = current as Error & { code?: unknown; hostname?: unknown };
        const host = typeof hostname === 'string' ? hostname : 'that address';
        if (code === 'ENOTFOUND') return `There is no server at ${host}.`;
        if (code === 'ECONNREFUSED') return `${host} refused the connection.`;

        if (current.message !== '') messages.push(current.message);
        current = current.cause;
    }
    const message = messages.at(-1) ?? 'It did not answer as an OpenID provider.';
    return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No answer within ${ms / 1000} seconds.`)), ms);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
