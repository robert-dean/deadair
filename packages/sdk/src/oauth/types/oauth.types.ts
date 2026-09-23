import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * An app's authorization request, as the consent page received it
 * generated from [OAuthAuthorizationQuery](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L7)
 */
export interface OAuthAuthorizationQuery {
    /** The query string the app sent the browser to the consent page with, as `window.location.search` holds it */
    query: string;
}

/**
 * How the station knows an app: registered by an operator, registered by itself, or described by a document on its own website
 * generated from [OAuthClientKind](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L11)
 */
export type OAuthClientKind = 'preregistered' | 'dynamic' | 'metadata_document';

/**
 * A request with something wrong that the app should be told about: send the browser back to it
 * generated from [OAuthAuthorizationRedirect](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L27)
 */
export interface OAuthAuthorizationRedirect {
    /** Discriminator */
    kind: 'redirect';
    /** Where to send the browser */
    redirectUrl: string;
}

/**
 * A request that names no app the station knows, or an address the app did not register. Never sent anywhere
 * generated from [OAuthAuthorizationRefusal](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L32)
 */
export interface OAuthAuthorizationRefusal {
    /** Discriminator */
    kind: 'refuse';
    /** The OAuth error code */
    error: string;
    /** What was wrong, in words */
    description: string;
}

/**
 * Approving or denying a stashed request
 * generated from [OAuthAuthorizationDecision](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L40)
 */
export interface OAuthAuthorizationDecision {
    /** From the context */
    requestId: string;
}

/**
 * Where to send the browser now
 * generated from [OAuthAuthorizationOutcome](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L44)
 */
export interface OAuthAuthorizationOutcome {
    /** The app's own address, carrying the code or the refusal */
    redirectUrl: string;
}

/**
 * How the app proves itself at the token endpoint. `none` is a public client, which is what apps on somebody's own device are
 * generated from [OAuthClientAuthMethod](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L48)
 */
export type OAuthClientAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

/**
 * An app the signed-in person has let act as them
 * generated from [OAuthGrant](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L76)
 */
export interface OAuthGrant {
    /** For disconnecting it */
    id: string;
    /** The app's client id */
    clientId: string;
    /** What the app calls itself, when the station can still find out */
    clientName?: string;
    /** What it can reach */
    resource: string;
    /** What it asked for */
    scope: string[];
    /** When it was first approved */
    createdAt: DateTime;
    /** When it last obtained a token */
    lastUsedAt?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a OAuthGrant into its runtime type. Mutates and returns `raw`. */
export function reviveOAuthGrant(raw: OAuthGrant): OAuthGrant {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'OAuthGrant.createdAt');
    if (__o0['lastUsedAt'] != null) {
        __o0['lastUsedAt'] = __dt(__o0['lastUsedAt'], 'OAuthGrant.lastUsedAt');
    }
    return raw;
}

/**
 * A valid request, stashed for the signed-in person to approve or deny
 * generated from [OAuthAuthorizationContext](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L13)
 */
export interface OAuthAuthorizationContext {
    /** Discriminator */
    kind: 'context';
    /** What approving or denying names. Good for a few minutes, and only for the person it was shown to */
    requestId: string;
    /** The app's client id */
    clientId: string;
    /** How the station knows the app */
    clientKind: OAuthClientKind;
    /** What the app calls itself */
    clientName?: string;
    /** The app's own website, when it gave one */
    clientUri?: string;
    /** The app's logo, when it gave one */
    logoUri?: string;
    /** The host the browser is sent back to, which is who actually receives the approval */
    redirectHost: string;
    /** Whether every address the app registered is this computer's own, which only an app running on it should use */
    loopbackOnly: boolean;
    /** What the app asked for. It acts as the person approving it whatever this says */
    scope: string[];
    /** What the app will be able to reach: the station's MCP endpoint */
    resource: string;
}

/**
 * An app registered with the station
 * generated from [OAuthClientSummary](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L50)
 */
export interface OAuthClientSummary {
    /** Its client id */
    clientId: string;
    /** Created by an operator, or registered by itself */
    kind: 'preregistered' | 'dynamic';
    /** What it is called */
    name?: string;
    /** Where it may be sent back to */
    redirectUris: string[];
    /** How it proves itself */
    tokenEndpointAuthMethod: OAuthClientAuthMethod;
    /** When it was registered */
    createdAt: DateTime;
    /** When it last obtained a token */
    lastUsedAt?: DateTime;
    /** When a self-registered app lapses unless used again */
    expiresAt?: DateTime;
}

/** Rehydrates every wire-encoded scalar in a OAuthClientSummary into its runtime type. Mutates and returns `raw`. */
export function reviveOAuthClientSummary(raw: OAuthClientSummary): OAuthClientSummary {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'OAuthClientSummary.createdAt');
    if (__o0['lastUsedAt'] != null) {
        __o0['lastUsedAt'] = __dt(__o0['lastUsedAt'], 'OAuthClientSummary.lastUsedAt');
    }
    if (__o0['expiresAt'] != null) {
        __o0['expiresAt'] = __dt(__o0['expiresAt'], 'OAuthClientSummary.expiresAt');
    }
    return raw;
}

/**
 * An app an operator registers by hand, for a client that cannot register itself
 * generated from [OAuthClientCreate](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L65)
 */
export interface OAuthClientCreate {
    /** What to call it */
    name: string;
    /** Where it may be sent back to. At least one; https, or this computer's own address */
    redirectUris: string[];
    /** `none` for an app on somebody's own device, otherwise a secret it keeps */
    tokenEndpointAuthMethod: OAuthClientAuthMethod;
}

/**
 * generated from [OAuthGrantList](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L86)
 */
export interface OAuthGrantList {
    /** Most recent first */
    grants: OAuthGrant[];
}

/** Rehydrates every wire-encoded scalar in a OAuthGrantList into its runtime type. Mutates and returns `raw`. */
export function reviveOAuthGrantList(raw: OAuthGrantList): OAuthGrantList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['grants'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveOAuthGrant(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * generated from [OAuthAuthorizationContextResult](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L38)
 */
export type OAuthAuthorizationContextResult = OAuthAuthorizationContext | OAuthAuthorizationRedirect | OAuthAuthorizationRefusal;

/**
 * generated from [OAuthClientList](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L61)
 */
export interface OAuthClientList {
    /** Newest first. Apps that describe themselves are not listed: nothing is stored for them */
    clients: OAuthClientSummary[];
}

/** Rehydrates every wire-encoded scalar in a OAuthClientList into its runtime type. Mutates and returns `raw`. */
export function reviveOAuthClientList(raw: OAuthClientList): OAuthClientList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['clients'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveOAuthClientSummary(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * A registered app, with its secret. The only time the secret is ever returned
 * generated from [OAuthClientIssued](../../../../../apps/api/data/contracts/oauth/oauth.types.ck#L71)
 */
export interface OAuthClientIssued {
    /** The app as it will appear in the list */
    client: OAuthClientSummary;
    /** Present for an app that keeps a secret. Store it now: nothing can show it again */
    clientSecret?: string;
}

/** Rehydrates every wire-encoded scalar in a OAuthClientIssued into its runtime type. Mutates and returns `raw`. */
export function reviveOAuthClientIssued(raw: OAuthClientIssued): OAuthClientIssued {
    const __o0 = raw as unknown as Record<string, unknown>;
    reviveOAuthClientSummary(__o0['client'] as never);
    return raw;
}
