import { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';

/**
 * The `deadair.settings` keys behind letting other apps connect to the station as its operators,
 * through OAuth: Claude's connectors first among them, reaching the station's MCP endpoint.
 */
export const OAUTH_KEYS = {
    /**
     * The whole switch, off by default. Off, the station publishes no discovery documents, registers
     * no client, issues no token and answers the MCP endpoint's every request as unauthenticated. A
     * station reachable from the internet should not start answering an authorization flow because
     * it was upgraded.
     */
    enabled: 'oauth.enabled',
    /**
     * Whether an app may register itself (RFC 7591). On by default once OAuth is, because that is
     * how Claude connects without anybody creating a client for it; off leaves pre-registered
     * clients and client id metadata documents.
     */
    dynamicRegistration: 'oauth.dynamicRegistration',
    /**
     * Hosts an app may identify itself from with a client id metadata document, comma separated.
     * Empty means any https host, which is the point of the mechanism.
     */
    clientMetadataHosts: 'oauth.clientMetadataHosts',
} as const;

export const OAUTH_DEFAULTS = {
    enabled: false,
    dynamicRegistration: true,
} as const;

/** Whether the station is an authorization server at all right now. Read live, per request. */
export const oauthIsEnabled = (config: AppConfig): boolean => settingIsOn(config, OAUTH_KEYS.enabled, OAUTH_DEFAULTS.enabled);

/** Whether apps may register themselves right now. Meaningless while OAuth is off. */
export const dynamicRegistrationIsOn = (config: AppConfig): boolean =>
    settingIsOn(config, OAUTH_KEYS.dynamicRegistration, OAUTH_DEFAULTS.dynamicRegistration);

/**
 * Whether a client id metadata document may be fetched from this host.
 *
 * Exact host names, lowercased, from `oauth.clientMetadataHosts`; an empty setting admits every
 * host, since the library already refuses IP literals, `localhost` and anything that is not https.
 * A leading `*.` admits that domain's subdomains and not the domain itself, which is how the rule
 * usually has to be written for a vendor that hosts its documents under its own name.
 */
export function clientMetadataHostAllowed(config: AppConfig, hostname: string): boolean {
    const entries = String(config.get(OAUTH_KEYS.clientMetadataHosts, ''))
        .split(/[\s,]+/)
        .map(entry => entry.trim().toLowerCase())
        .filter(entry => entry.length > 0);
    if (entries.length === 0) return true;

    const host = hostname.toLowerCase();
    return entries.some(entry => (entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry));
}
