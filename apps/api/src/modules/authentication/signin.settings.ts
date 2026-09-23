import { AppConfig } from '@maroonedsoftware/appconfig';
import { parseRows, ROW_ID_KEY, rowSecretKey, type ConfigFieldColumn, type ConfigFieldPreset } from '@deadair/plugin-sdk';

/**
 * The `deadair.settings` keys behind signing in through an identity provider.
 *
 * In the database rather than the environment, on the rule `mail.settings.ts` states: nothing here
 * is needed before the first request, and an operator should be able to add a provider from the
 * console rather than by editing a `.env` and restarting. The Google variables this replaced are
 * seeded into `providers` once, so a station that had them keeps signing in.
 */
export const SIGNIN_KEYS = {
    /** A `list`: one row per identity provider, its client secret held per row. */
    providers: 'signin.providers',
    /** Who may sign in through a provider for the FIRST time. See {@link parseAllowlist}. */
    allowlist: 'signin.allowlist',
    /**
     * A `note`, never stored: the address every provider is registered with. Its value reaches the
     * console as a derived setting, from {@link oidcRedirectUri}.
     */
    redirectAddress: 'signin.redirectAddress',
} as const;

/** The cell keys of a provider row, shared by the registry's columns and the resolver below. */
export const SIGNIN_PROVIDER_CELLS = {
    name: 'name',
    label: 'label',
    issuer: 'issuer',
    clientId: 'clientId',
    clientSecret: 'clientSecret',
    scopes: 'scopes',
    authorizeParams: 'authorizeParams',
} as const;

/** What an OpenID Connect sign-in asks for when a row names nothing. */
export const DEFAULT_SIGNIN_SCOPES: readonly string[] = ['openid', 'email', 'profile'];

/**
 * The shape a provider's name must have.
 *
 * Lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 32. It goes into
 * a URL, into the contract as `string(max=32)`, and onto every account linked through the provider
 * (`actors_oidc_factors.provider`), which is why renaming one orphans those links: the console says
 * so beside the column.
 */
export const SIGNIN_PROVIDER_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The columns of the provider list, in the order the console draws them. */
export const SIGNIN_PROVIDER_COLUMNS: ConfigFieldColumn[] = [
    { key: SIGNIN_PROVIDER_CELLS.name, label: 'Name', type: 'string', required: true, placeholder: 'authelia' },
    { key: SIGNIN_PROVIDER_CELLS.label, label: 'Button', type: 'string', required: true, placeholder: 'Authelia' },
    { key: SIGNIN_PROVIDER_CELLS.issuer, label: 'Issuer', type: 'url', required: true, placeholder: 'https://auth.example.com' },
    { key: SIGNIN_PROVIDER_CELLS.clientId, label: 'Client id', type: 'string', required: true },
    { key: SIGNIN_PROVIDER_CELLS.clientSecret, label: 'Client secret', type: 'secret' },
    { key: SIGNIN_PROVIDER_CELLS.scopes, label: 'Scopes', type: 'string', placeholder: DEFAULT_SIGNIN_SCOPES.join(' ') },
    { key: SIGNIN_PROVIDER_CELLS.authorizeParams, label: 'Extra parameters', type: 'string', placeholder: 'prompt=select_account' },
];

/**
 * The providers an operator is likely to be adding, as rows to start from.
 *
 * Only what is the same on every station is filled in: a name, a button, and the issuer, which is
 * fixed for Google and has a fixed SHAPE for the rest. Where it depends on the operator's own server
 * the shape is filled in with `auth.example.com` and a placeholder segment, because an empty issuer
 * says nothing about what goes there and the shape is exactly what somebody setting up Keycloak for
 * the first time does not know. The client id and secret are the provider's to issue and are never
 * here. Google's `prompt=select_account` is so a browser signed in to two Google accounts asks which
 * rather than quietly using whichever it signed in to last.
 */
export const SIGNIN_PROVIDER_PRESETS: ConfigFieldPreset[] = [
    {
        label: 'Google',
        cells: {
            [SIGNIN_PROVIDER_CELLS.name]: 'google',
            [SIGNIN_PROVIDER_CELLS.label]: 'Google',
            [SIGNIN_PROVIDER_CELLS.issuer]: 'https://accounts.google.com',
            [SIGNIN_PROVIDER_CELLS.authorizeParams]: 'prompt=select_account',
        },
    },
    {
        label: 'Microsoft',
        cells: {
            [SIGNIN_PROVIDER_CELLS.name]: 'microsoft',
            [SIGNIN_PROVIDER_CELLS.label]: 'Microsoft',
            [SIGNIN_PROVIDER_CELLS.issuer]: 'https://login.microsoftonline.com/your-tenant-id/v2.0',
        },
    },
    {
        label: 'Authelia',
        cells: {
            [SIGNIN_PROVIDER_CELLS.name]: 'authelia',
            [SIGNIN_PROVIDER_CELLS.label]: 'Authelia',
            [SIGNIN_PROVIDER_CELLS.issuer]: 'https://auth.example.com',
        },
    },
    {
        label: 'Authentik',
        cells: {
            [SIGNIN_PROVIDER_CELLS.name]: 'authentik',
            [SIGNIN_PROVIDER_CELLS.label]: 'Authentik',
            [SIGNIN_PROVIDER_CELLS.issuer]: 'https://auth.example.com/application/o/deadair/',
        },
    },
    {
        label: 'Keycloak',
        cells: {
            [SIGNIN_PROVIDER_CELLS.name]: 'keycloak',
            [SIGNIN_PROVIDER_CELLS.label]: 'Keycloak',
            [SIGNIN_PROVIDER_CELLS.issuer]: 'https://auth.example.com/realms/your-realm',
        },
    },
];

/**
 * Where an identity provider sends the browser back to after sign-in, and so the address an
 * operator registers with it as the redirect URI. One address for every provider: the state the
 * station hands out with each sign-in says which provider it was.
 *
 * `APP_BASE_URL` is the station's ORIGIN, the address a browser reaches the console on, and every
 * edge in front of the API (the image's nginx, both compose edges, Vite's proxy) passes it only
 * what arrives under `/api/`, with that prefix stripped. The route is `/auth/login/oidc/callback`
 * on the API, so on the origin it is `/api/auth/login/oidc/callback`. Built without the prefix,
 * which it was, Google's return fell through to the console and landed on its not-found page.
 *
 * Here rather than in the module file so the settings read can show it to the operator without
 * importing the module that registers everything else.
 */
export function oidcRedirectUri(config: AppConfig): URL {
    const origin = String(config.get('APP_BASE_URL', '')).trim().replace(/\/+$/, '');
    return new URL(`${origin}/api/auth/login/oidc/callback`);
}

/** One identity provider the station can send somebody to, as the sign-in flow needs it. */
export interface SigninProvider {
    /** The operator's slug: in URLs, and stored on every account linked through this provider. */
    name: string;
    /** What the sign-in button says. */
    label: string;
    issuer: URL;
    clientId: string;
    /** Absent for a public client, which the provider has to allow. PKCE is always on. */
    clientSecret?: string;
    scopes: string[];
    /** Added to the authorization request as they are, e.g. `prompt=select_account`. */
    authorizeParams?: Record<string, string>;
}

/**
 * The identity providers the station offers, from `signin.providers`.
 *
 * Tolerant in the way a resolver has to be: a row that cannot be used is dropped rather than taking
 * every other provider down with it, and `warn` is told why. A row is unusable when a required cell
 * is empty, when its name is not a slug ({@link SIGNIN_PROVIDER_NAME}) or when its issuer is not an
 * http or https URL. Names are lowercased; the first of two rows with one name wins.
 *
 * `decrypt` turns a stored client secret back into what the provider expects. A value it cannot
 * decrypt is taken as written, as `resolveMailSettings` does, because a secret seeded by hand with
 * psql is a reasonable thing to find and refusing it would take sign-in down rather than one row.
 */
export function resolveSigninProviders(
    config: AppConfig,
    decrypt: (ciphertext: string) => string,
    warn: (message: string) => void = () => {},
): SigninProvider[] {
    const providers: SigninProvider[] = [];
    const seen = new Set<string>();

    for (const row of parseRows(config.get(SIGNIN_KEYS.providers, ''))) {
        const cell = (key: string) => row[key]?.trim() ?? '';

        const name = cell(SIGNIN_PROVIDER_CELLS.name).toLowerCase();
        const label = cell(SIGNIN_PROVIDER_CELLS.label);
        const clientId = cell(SIGNIN_PROVIDER_CELLS.clientId);
        const issuer = httpUrl(cell(SIGNIN_PROVIDER_CELLS.issuer));

        if (!SIGNIN_PROVIDER_NAME.test(name)) {
            warn(`sign-in: a provider row is skipped because its name "${name}" is not a slug`);
            continue;
        }
        if (label === '' || clientId === '' || issuer === undefined) {
            warn(`sign-in: provider "${name}" is skipped because its button, issuer or client id is missing or not usable`);
            continue;
        }
        if (seen.has(name)) {
            warn(`sign-in: a second provider named "${name}" is skipped; the first one wins`);
            continue;
        }
        seen.add(name);

        const rowId = row[ROW_ID_KEY];
        const clientSecret =
            rowId === undefined
                ? undefined
                : storedSecret(config, rowSecretKey(SIGNIN_KEYS.providers, rowId, SIGNIN_PROVIDER_CELLS.clientSecret), decrypt);
        const authorizeParams = parseAuthorizeParams(cell(SIGNIN_PROVIDER_CELLS.authorizeParams));

        providers.push({
            name,
            label,
            issuer,
            clientId,
            ...(clientSecret === undefined ? {} : { clientSecret }),
            scopes: parseScopes(cell(SIGNIN_PROVIDER_CELLS.scopes)),
            ...(authorizeParams === undefined ? {} : { authorizeParams }),
        });
    }

    return providers;
}

/**
 * The scopes a row asks for: space or comma separated, `openid` always among them.
 *
 * `openid` is forced rather than trusted to the operator, because without it the provider answers
 * with plain OAuth and no id token, and the failure that produces names nothing an operator typed.
 */
export function parseScopes(raw: string): string[] {
    const scopes = raw.split(/[\s,]+/).filter(scope => scope.length > 0);
    if (scopes.length === 0) return [...DEFAULT_SIGNIN_SCOPES];
    return scopes.includes('openid') ? scopes : ['openid', ...scopes];
}

/** `prompt=select_account&hd=example.com` as a map, or nothing when the cell is empty. */
export function parseAuthorizeParams(raw: string): Record<string, string> | undefined {
    if (raw === '') return undefined;
    const params: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(raw)) {
        if (key !== '') params[key] = value;
    }
    return Object.keys(params).length > 0 ? params : undefined;
}

/** Who may sign in through a provider for the first time: whole addresses, and whole domains. */
export interface SigninAllowlist {
    emails: ReadonlySet<string>;
    domains: ReadonlySet<string>;
}

/**
 * `signin.allowlist` as addresses and domains.
 *
 * One entry per line, or separated by commas or spaces. An entry with an `@` in the middle is an
 * address; anything else is a domain, and a leading `@` is allowed so `@example.com` reads the way
 * people write it. Everything is lowercased. A domain admits that domain only, not its subdomains:
 * `example.com` does not let in `someone@mail.example.com`, because a list that grew silently to
 * cover hosts nobody named is the wrong way for an allowlist to fail.
 */
export function parseAllowlist(raw: string | undefined): SigninAllowlist {
    const emails = new Set<string>();
    const domains = new Set<string>();

    for (const entry of (raw ?? '').split(/[\s,]+/)) {
        const value = entry.trim().toLowerCase();
        if (value === '') continue;
        if (value.startsWith('@')) domains.add(value.slice(1));
        else if (value.includes('@')) emails.add(value);
        else domains.add(value);
    }

    return { emails, domains };
}

/**
 * Whether the list lets this address in. An identity with no address is never admitted: there is
 * nothing to hold it against, and admitting it would make the list meaningless for a provider that
 * does not share one.
 */
export function allowlistAdmits(list: SigninAllowlist, email: string | undefined): boolean {
    const address = email?.trim().toLowerCase();
    if (!address) return false;
    if (list.emails.has(address)) return true;

    const at = address.lastIndexOf('@');
    return at > 0 && list.domains.has(address.slice(at + 1));
}

/** The allowlist as the station holds it now. */
export const resolveSigninAllowlist = (config: AppConfig): SigninAllowlist => parseAllowlist(config.get(SIGNIN_KEYS.allowlist, ''));

function httpUrl(raw: string): URL | undefined {
    if (raw === '') return undefined;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
    } catch {
        return undefined;
    }
}

function storedSecret(config: AppConfig, key: string, decrypt: (ciphertext: string) => string): string | undefined {
    if (!config.has(key)) return undefined;
    const raw = String(config.get(key, '')).trim();
    if (raw === '') return undefined;
    try {
        return decrypt(raw);
    } catch {
        return raw;
    }
}
