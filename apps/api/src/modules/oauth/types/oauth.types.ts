import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * An app's authorization request, as the consent page received it
 * generated from [OAuthAuthorizationQuery](../../../../data/contracts/oauth/oauth.types.ck#L7)
 */
export const OAuthAuthorizationQuery = z.strictObject({
    query: z.string().max(8192).describe('The query string the app sent the browser to the consent page with, as `window.location.search` holds it'),
});
export type OAuthAuthorizationQuery = z.infer<typeof OAuthAuthorizationQuery>;

/**
 * How the station knows an app: registered by an operator, registered by itself, or described by a document on its own website
 * generated from [OAuthClientKind](../../../../data/contracts/oauth/oauth.types.ck#L11)
 */
export const OAuthClientKind = z.enum(['preregistered', 'dynamic', 'metadata_document']);
export type OAuthClientKind = z.infer<typeof OAuthClientKind>;

/**
 * A request with something wrong that the app should be told about: send the browser back to it
 * generated from [OAuthAuthorizationRedirect](../../../../data/contracts/oauth/oauth.types.ck#L27)
 */
export const OAuthAuthorizationRedirect = z.strictObject({
    kind: z.literal('redirect').describe('Discriminator'),
    redirectUrl: z.string().describe('Where to send the browser'),
});
export type OAuthAuthorizationRedirect = z.infer<typeof OAuthAuthorizationRedirect>;

/**
 * A request that names no app the station knows, or an address the app did not register. Never sent anywhere
 * generated from [OAuthAuthorizationRefusal](../../../../data/contracts/oauth/oauth.types.ck#L32)
 */
export const OAuthAuthorizationRefusal = z.strictObject({
    kind: z.literal('refuse').describe('Discriminator'),
    error: z.string().describe('The OAuth error code'),
    description: z.string().describe('What was wrong, in words'),
});
export type OAuthAuthorizationRefusal = z.infer<typeof OAuthAuthorizationRefusal>;

/**
 * Approving or denying a stashed request
 * generated from [OAuthAuthorizationDecision](../../../../data/contracts/oauth/oauth.types.ck#L40)
 */
export const OAuthAuthorizationDecision = z.strictObject({
    requestId: z.string().max(200).describe('From the context'),
});
export type OAuthAuthorizationDecision = z.infer<typeof OAuthAuthorizationDecision>;

/**
 * Where to send the browser now
 * generated from [OAuthAuthorizationOutcome](../../../../data/contracts/oauth/oauth.types.ck#L44)
 */
export const OAuthAuthorizationOutcome = z.strictObject({
    redirectUrl: z.string().describe("The app's own address, carrying the code or the refusal"),
});
export type OAuthAuthorizationOutcome = z.infer<typeof OAuthAuthorizationOutcome>;

/**
 * How the app proves itself at the token endpoint. `none` is a public client, which is what apps on somebody's own device are
 * generated from [OAuthClientAuthMethod](../../../../data/contracts/oauth/oauth.types.ck#L48)
 */
export const OAuthClientAuthMethod = z.enum(['none', 'client_secret_post', 'client_secret_basic']);
export type OAuthClientAuthMethod = z.infer<typeof OAuthClientAuthMethod>;

/**
 * An app the signed-in person has let act as them
 * generated from [OAuthGrant](../../../../data/contracts/oauth/oauth.types.ck#L76)
 */
export const OAuthGrant = z.strictObject({
    id: z.uuid().describe('For disconnecting it'),
    clientId: z.string().describe("The app's client id"),
    clientName: z.string().optional().describe('What the app calls itself, when the station can still find out'),
    resource: z.string().describe('What it can reach'),
    scope: z.array(z.string()).describe('What it asked for'),
    createdAt: _ZodDatetime.describe('When it was first approved'),
    lastUsedAt: _ZodDatetime.optional().describe('When it last obtained a token'),
});
export type OAuthGrant = z.infer<typeof OAuthGrant>;

/**
 * A valid request, stashed for the signed-in person to approve or deny
 * generated from [OAuthAuthorizationContext](../../../../data/contracts/oauth/oauth.types.ck#L13)
 */
export const OAuthAuthorizationContext = z.strictObject({
    kind: z.literal('context').describe('Discriminator'),
    requestId: z.string().max(200).describe('What approving or denying names. Good for a few minutes, and only for the person it was shown to'),
    clientId: z.string().describe("The app's client id"),
    clientKind: OAuthClientKind.describe('How the station knows the app'),
    clientName: z.string().optional().describe('What the app calls itself'),
    clientUri: z.string().optional().describe("The app's own website, when it gave one"),
    logoUri: z.string().optional().describe("The app's logo, when it gave one"),
    redirectHost: z.string().describe('The host the browser is sent back to, which is who actually receives the approval'),
    loopbackOnly: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe("Whether every address the app registered is this computer's own, which only an app running on it should use"),
    scope: z.array(z.string()).describe('What the app asked for. It acts as the person approving it whatever this says'),
    resource: z.string().describe("What the app will be able to reach: the station's MCP endpoint"),
});
export type OAuthAuthorizationContext = z.infer<typeof OAuthAuthorizationContext>;

/**
 * An app registered with the station
 * generated from [OAuthClientSummary](../../../../data/contracts/oauth/oauth.types.ck#L50)
 */
export const OAuthClientSummary = z.strictObject({
    clientId: z.string().describe('Its client id'),
    kind: z.enum(['preregistered', 'dynamic']).describe('Created by an operator, or registered by itself'),
    name: z.string().optional().describe('What it is called'),
    redirectUris: z.array(z.string()).describe('Where it may be sent back to'),
    tokenEndpointAuthMethod: OAuthClientAuthMethod.describe('How it proves itself'),
    createdAt: _ZodDatetime.describe('When it was registered'),
    lastUsedAt: _ZodDatetime.optional().describe('When it last obtained a token'),
    expiresAt: _ZodDatetime.optional().describe('When a self-registered app lapses unless used again'),
});
export type OAuthClientSummary = z.infer<typeof OAuthClientSummary>;

/**
 * An app an operator registers by hand, for a client that cannot register itself
 * generated from [OAuthClientCreate](../../../../data/contracts/oauth/oauth.types.ck#L65)
 */
export const OAuthClientCreate = z.strictObject({
    name: z.string().min(1).max(100).describe('What to call it'),
    redirectUris: z.array(z.string().max(2048)).describe("Where it may be sent back to. At least one; https, or this computer's own address"),
    tokenEndpointAuthMethod: OAuthClientAuthMethod.describe("`none` for an app on somebody's own device, otherwise a secret it keeps"),
});
export type OAuthClientCreate = z.infer<typeof OAuthClientCreate>;

/**
 * generated from [OAuthGrantList](../../../../data/contracts/oauth/oauth.types.ck#L86)
 */
export const OAuthGrantList = z.strictObject({
    grants: z.array(OAuthGrant).describe('Most recent first'),
});
export type OAuthGrantList = z.infer<typeof OAuthGrantList>;

/**
 * generated from [OAuthAuthorizationContextResult](../../../../data/contracts/oauth/oauth.types.ck#L38)
 */
export const OAuthAuthorizationContextResult = z.discriminatedUnion('kind', [
    OAuthAuthorizationContext,
    OAuthAuthorizationRedirect,
    OAuthAuthorizationRefusal,
]);
export type OAuthAuthorizationContextResult = z.infer<typeof OAuthAuthorizationContextResult>;

/**
 * generated from [OAuthClientList](../../../../data/contracts/oauth/oauth.types.ck#L61)
 */
export const OAuthClientList = z.strictObject({
    clients: z.array(OAuthClientSummary).describe('Newest first. Apps that describe themselves are not listed: nothing is stored for them'),
});
export type OAuthClientList = z.infer<typeof OAuthClientList>;

/**
 * A registered app, with its secret. The only time the secret is ever returned
 * generated from [OAuthClientIssued](../../../../data/contracts/oauth/oauth.types.ck#L71)
 */
export const OAuthClientIssued = z.strictObject({
    client: OAuthClientSummary.describe('The app as it will appear in the list'),
    clientSecret: z.string().optional().describe('Present for an app that keeps a secret. Store it now: nothing can show it again'),
});
export type OAuthClientIssued = z.infer<typeof OAuthClientIssued>;
