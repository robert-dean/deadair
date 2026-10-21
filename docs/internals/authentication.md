# Internals: signing in, both ways

Where the identity providers come from, who may join through one, how a link is made and undone, and
what the station does with the Google variables it used to read. Then the other direction: the station
as an OAuth authorization server, for apps that connect to it as one of its people. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md); the chassis the module sits on is [`apps/api/CLAUDE.md`](../../apps/api/CLAUDE.md).

## Where the providers come from

**The console's list is the only source, and it is read on every lookup.** `signin.providers` is a
`list` setting in the `signin` group, one row per OpenID Connect provider: name, button text,
issuer, client id, client secret, scopes, extra authorize parameters. `SettingsOidcProviderSource`
is the `OidcProviderSource` the library's registry asks, and since
`@maroonedsoftware/authentication` 6 the registry asks on every lookup, so a row added, edited or
deleted in the console applies to the next sign-in with no restart. The registry keys its discovery
cache on a fingerprint of issuer, client id, secret and `allowInsecureIssuer`, which is what makes a
rotated secret rediscover rather than keep signing with the old one.

**A provider's client secret is a row secret**, encrypted per cell and stored as its own
`deadair.settings` row under `signin.providers/<rowId>/clientSecret`
(`modules/shared/config.rows.ts`, which the plugin configs used first). `SettingsService` splits a
submitted list into the rows it stores and the cells it encrypts, deletes the cell of a row that was
removed, and refuses a list that is not JSON text rather than reading it as no rows and deleting
every secret. The source decrypts in a scope of its own, because `EncryptionProvider` is scoped and
the registry holding the source is a singleton.

**`resolveSigninProviders` is tolerant on the resolver rule**: a row it cannot use (a name that is
not a lowercase slug, a missing button, issuer or client id, an issuer that is not http or https)
is skipped and named in the log once, and costs no other row. `openid` is always among the scopes.
A secret that does not decrypt is taken as written, as `resolveMailSettings` does, for a row seeded
by hand. `GET /auth/login/oidc/providers`, which the sign-in page asks before anybody is signed in,
answers through the same resolver, so a row the station cannot sign in through is not offered as a
button either.

**A provider's name is recorded on every account linked through it**
(`actors_oidc_factors.provider`), so renaming a row orphans those links. The console says so beside
the column. **One redirect address serves every provider**, `APP_BASE_URL` followed by
`/api/auth/login/oidc/callback`, because the state the station hands out with each sign-in names
the provider it began with. The settings page shows it with a Copy button: a `note` in the `signin`
group (`signin.redirectAddress`) whose value arrives as a derived setting, built by the same
`oidcRedirectUri` the source hands the registry, so what the operator pastes cannot disagree with
what the station sends.

**The list offers presets** (`SIGNIN_PROVIDER_PRESETS`): Google, Microsoft, Authelia, Authentik and
Keycloak, each filling the name, the button and the issuer, or the issuer's shape with
`auth.example.com` and a placeholder segment where it depends on the operator's own server. Nothing
fills the client id or secret. That is the provider's to issue, and the only way round it, dynamic
client registration, is closed to an outside app at Google and Authelia and needs a token copied
from Keycloak anyway. A test holds every preset, given a client id, to a row the resolver keeps.

**`GET /settings/signin/check` asks each provider whether it answers**, through
`OidcProviderRegistry.getConfiguration`, which is the discovery a sign-in runs rather than a second
fetch of the discovery document that could pass where sign-in fails. It also returns the resolver's
warnings as sentences, because a dropped row is a button that silently never appears. The console
asks once per saved provider list (the query is keyed on the stored value), never on focus or a
timer, since each ask reaches every issuer. `problemOf` puts the two failures an operator causes
most into words: `ENOTFOUND` for a host that is not there, and a `Response` cause for a wrong issuer
path, which `openid-client` reports as "unexpected HTTP response status code" without the status.
It is manage-only, on the argument that reaching out to an address is an operator's action.

## Who may join

**An identity the station already knows signs in whatever the allowlist says.** The library
resolves a callback to an account by `(provider, subject)` first and then, when the provider
vouches for the address, by the account holding that email factor (the auto-link). Either answer
signs in; neither consults `signin.allowlist`.

**Anybody else gets an account only when the allowlist names their provider-verified address or its
domain.** The gate is in `provisionOidcNewUser`, on the library's `new-user` answer, and not in the
`auth.factor.oidc.profile.allowed` policy, for three reasons: the library has done both lookups by
then, so a policy would repeat them and could drift from them; the policy has no `intent`, so it
would block an administrator linking a provider the list does not name to their own account; and
`new-user` has written nothing yet, so refusing there is clean. An unverified address is never held
against the list, because it is whatever the person typed at the provider. A domain covers itself
only, not its subdomains.

**`email_unverified` is refused before the allowlist is read**: an account with the address exists
but the provider does not vouch for it, and a second account would shadow the first. An admitted
newcomer gets the `listener` role through `PermissionsService.writeDirect`, as onboarding grants
`admin`, and nothing more.

**Every refusal lands on the console's own callback page** with `?error=<code>` and a sentence in
`error_description`, never an exception's message in the URL: `not_allowed`, `email_unverified`,
`oidc_failed` for anything else, or the provider's own error. `OidcSignInRefused` carries the code
and the sentence.

**A callback is honoured only in the browser that started it.** The library trusts whichever stored
state record a callback's `state` names, and the PKCE verifier and nonce live in that record, so they
prove nothing about the browser. Without a binding, somebody could begin a sign-in, stop at the
provider's redirect and send the callback URL to somebody else, whose console would be signed in as
them; a link the same way puts the victim's identity on the attacker's account. So both places a flow
begins (`handleOidcStartLogin` and `registerOidcFactor`) put the `state` in the `deadair.oidc`
httpOnly cookie through the `ResponseCookieJar`, for as long as the state lives, and the callback
compares it before `completeAuthorization` reads anything, refusing a mismatch as `not_started_here`.
SameSite=Lax is enough, because the provider returns the browser with a top-level GET. Two details
are deliberate: the cookie is cleared only by a callback that MATCHED it, since clearing on a mismatch
would let somebody else's link cancel the sign-in this browser has in flight; and one cookie holds one
state, so a second sign-in started in another tab wins and the first tab is asked to start again. A
provider's own `?error=` skips the check and is still reported as `provider_error`. Only the web
console starts these flows, so no app is affected.

## Passkeys

**A passkey's relying party is the address the browser is on, held to the addresses the station is
deployed at.** A self-hosted station has no fixed domain, so `PasskeyRelyingParty` reads it per
request from `Origin` and answers `{ rpId, rpOrigin }` only when that origin is `SPA_BASE_URL`,
`APP_BASE_URL` or `stream.publicUrl` (and `localhost` under `NODE_ENV=development`). Echoing the
origin back unchecked is the tempting fix and the wrong one: a page on another domain would be handed
a challenge its own passkey could answer, which is the phishing passkeys exist to stop. Every passkey
call goes through it: registration, passkey sign-in, the passkey second step and invitation
acceptance. Before it, registration used `'deadair'` and sign-in `localhost`, so no real browser
could use any of the passkey routes.

**WebAuthn needs a secure context**, so a station opened over plain `http://` on a LAN address offers
no passkey anywhere: `passkeysAvailable()` in the console is false there and every passkey control is
hidden rather than failing. The phone apps and the desktop app answer authenticator codes and
emailed codes (`ChallengeFactors.kt`, `AccountState.swift`, and on the desktop
`ChallengeFactors.Email` and `SessionManager.SendEmailCodeAsync`), sending an emailed one through
`POST /auth/factors/start` and redeeming it with the `code` grant, as the console does. The desktop
and iOS apps do not answer a passkey, so there a passkey is a browser second step and the invite page
says so.

**The Android app answers a passkey as well, and the station has to be told who is asking.** A native
app sends no `Origin`, and the assertion Credential Manager makes names the APP in its `clientDataJSON`:
`android:apk-key-hash:` and the base64url SHA-256 of the signing certificate. fido2-lib accepts that
origin, but only as the single expected origin fixed when the challenge is issued, so the app names its
own in `x-deadair-app-origin` when it starts the challenge. `PasskeyRelyingParty.resolveForAssertion`
answers that with the station's public host (`stream.publicUrl`, else `SPA_BASE_URL`/`APP_BASE_URL`) as
the relying party, which is the host the console registered the passkey at, and the app's origin as the
expected one, and only when it is https and the certificate is one the station vouches for: the
published app's (`OFFICIAL_ANDROID_CERTIFICATES` in `android.apps.ts`) or one listed in
`signin.androidCertificates`, which is how a debug build is let in. Accepting the header unchecked would
change nothing about phishing, since Android will not hand an app a passkey its host does not vouch for,
but it would make the station's answer depend on what a caller claims; held to the list, an app can name
only an origin it could genuinely have. Registration never comes here: a passkey is made in the console
and only proved from the app. The same list is published at `/.well-known/assetlinks.json`
(`assetlinks.router.ts`, both packages, `delegate_permission/common.get_login_creds`), which is what
Credential Manager reads from the host before it lets the app use the passkey; each station serves it
for itself because each is on its operator's own domain. So a station with no public https address has
no passkey in the app, and says so (`E10014`) rather than starting one that cannot be answered.

**Two things that broke the app's half before it worked.** The start response carried `rawChallenge`, a
Buffer that goes over the wire as `{"type":"Buffer","data":[...]}`; nothing read it and the Kotlin SDK,
typing it as bytes, could not decode the response at all, so it is dropped. And the generated clients
form-encode `/auth/token` by default, which cannot carry the `fido` grant's `credential` object (a form
field is text, and the contract refuses it as `{"credential":"Expected object"}`), so the app sends that
one grant as JSON through the SDK's own runtime. A passkey challenge is also shared between the console
and the app for its five minutes, because the library hands back the live challenge for the same actor
and factor; started in a browser and answered from the app inside that window, it carries the web origin
and is refused, and starting again after it expires is the way out.

**An emailed code signs in and never steps up.** `StrongFactorGate` excludes email, password and
oidc from every step-up, so the desktop's step-up dialog asks only for an authenticator: an account
whose only strong factor is a passkey makes those changes on the console, and one with nothing
stronger than email is never asked.

**The station sends a challenge as standard base64 and the browser writes it into clientData as
base64url.** `auth/webauthn.ts` decodes either, and a scripted authenticator has to encode the same
way or `fido2-lib` refuses it as "not properly encoded base64url".

## Invitations

**An invitation is the other way in, and the only one that can make an admin.** An admin names an
address and a role (`users/invitations.ck`); the station mints a `di_` token, stores its sha256 and
a copy sealed with the root key (the party pass's pattern, so the console can show an open link
again), and the link is `/invite#<token>`. One pending invitation per address, held by a partial
unique index; inviting the address again withdraws the first, which is how a resend works. An
admin's link lasts 48 hours and a listener's a week, and expiry is read off `expires_at` rather than
swept. Nothing in `deadair.invitations` is ever deleted.

**Accepting makes the account an onboarded admin has, plus a second step, all at once.**
`InvitationAcceptService` has three public routes and none is a GET or is called on page load, so a
mail scanner fetching the link spends nothing. `details` changes nothing. `start` checks the
password's strength and registers an authenticator or a passkey against an account id chosen then,
for an account that does not exist yet; the id waits in the cache under the registration. `accept`
makes the actor with that id, spends the invitation in one conditional `update` (which is what makes
it single-use under a race), writes the email and password factors, proves and writes the second
factor, and assigns the role on the inviter's authority. All of it is the request's transaction, so
a wrong code or a refused passkey leaves no account and an open invitation. The address is the
invited one and the person cannot change it there; an admin never can.

**An address that already has an account is refused, at invitation and again at acceptance,** with
`INVITATION_ALREADY_MEMBER`: an invitation that could attach a role to an existing account would let
whoever holds the link skip that account's own second step.

## Linking and unlinking

**A link is an ordinary factor registration** (`POST /auth/factors/register` with
`{ method: 'oidc', provider }`), behind the same recent-strong-factor gate as enrolling anything
else. It begins an authorization with `intent: 'link'` for the signed-in account and answers the
provider's address. The callback sees `result.intent === 'link'`, stashes nothing, and lands on
`/settings/security?linked=<provider>`: there is nobody to sign in, the person linking already is.

**The library refuses a link to an identity another account holds** with a 409 whose details name
the provider (reason `subject_taken` in the audit). The callback sends that to
`/settings/security?link_error=already_linked` rather than to a sign-in page telling a signed-in
person they are not.

**Unlinking is refused when the provider is the account's only way in**: no password, no other
provider, and no email address the station could mail a sign-in link to (an email factor counts only
while mail is configured). An account created through a provider starts out exactly like that.

**An account with no password cannot use the listener apps**, which sign in with a password and then
a second step (an authenticator's code, an emailed one, or on Android a passkey). Password sign-in
stays.

## Password lockout

**Five wrong passwords lock out the CALLER for five minutes, not the account.** The library's
`PasswordFactorService` spends one point per attempt under the actor's id, and keyed by that alone
anybody on the internet could keep the operator out of their own station with five guesses every
five minutes. `PasswordRateLimiter` (`password.rate.limiter.ts`) wraps the Redis limiter and
prefixes every key with the request's `clientAddress`, which the authorization context middleware
puts on the `AuthorizationContext` envelope beside `ipAddress`: the same `clientAddress` under
`TRUST_PROXY` the rate limiter keys on, never the raw peer, which behind the edge is nginx and would
put everybody back in one bucket. It is read when the limiter is called, not when it is built.

**An address with no account spends from the same limiter**, under `email:<address>` lowercased, so
it answers 401 five times and then 429 exactly as a real one does. Before, it answered 401 forever,
and the sixth try said whether the account existed. The cost of the per-caller key is the usual one:
a guesser spread over many addresses gets five tries from each, which is what the Argon2 cost and
the rate limiter in front are for.

## Changing a password

**`PUT /auth/password` is the one way to change a password, and it asks for the current one.**
`PasswordChangeService` (`password.change.service.ts`) is a route of its own rather than another arm
of `POST /auth/factors/register`, because that one creates a password and answers 409 when there is
one. A replacement goes through the library's `updatePasswordFactor`, which refuses any of the last
ten (`changePassword` does not); an account with no password gets one through `createPasswordFactor`
with nothing to prove. Once an authenticator or a passkey is enrolled, `StrongFactorGate` asks for it
too, exactly as enrolling anything does.

**A sign-in link used in the last ten minutes stands in for the current password.** Proving the inbox
is what a reset is, so the reset flow can be a sign-in link that lands on the password form rather
than a second kind of token with its own store, limiter and enumeration answers. It grants nothing a
sign-in link did not: whoever can read the inbox can already sign in, and an account with a strong
factor is asked for it at that sign-in and again here. The check reads the session's own factors
for an `email` one authenticated inside `LINK_STANDS_IN_FOR`, so an emailed second-step code counts
as well, which is right: that session proved the password a moment before.

**A wrong current password answers 400, not the library's 401.** The route is reached signed in, and
the console reads a 401 as a session that has ended. The 429 after too many wrong ones is passed
through unchanged, from the same caller-keyed limiter sign-in spends from.

**Every other session is signed out and every address is told.** The caller's own session stays, so
the page that asked is still signed in when the answer arrives. The `PasswordChanged` notice goes to
each active email factor after the commit, on the second-step reset notice's rule: a refused send is
logged and never undoes the change, and a station with no mail server changes the password anyway.

## Resetting a password

**A reset link is a sign-in link with `purpose: 'reset'`**, asked for at `POST /auth/login/start` with
`grant_type: 'link'`. `handleLinkStartLogin` issues the same `magiclink` challenge, spends from the same
`SignInMailLimiter` bucket and gives an address with no account the same synthetic answer; only the
template (`PasswordReset`) and the link's `redirect`, `PASSWORD_RESET_LANDING`, differ. Redeeming it is an
ordinary link sign-in through `issueOrChallenge`, so an enrolled authenticator or passkey is still asked
for, and the session it makes is the one `PUT /auth/password` lets set a password without the old one.
A separate reset token with its own store was the obvious design and is the one not built: it would
have needed its own limiter, its own enumeration answer and its own MFA story, each of which the
sign-in link already got right once.

## The Google variables

`GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET` and `GOOGLE_OIDC_ISSUER` used to build the only
provider there was. `seedSigninProvidersFromEnv` copies them into `signin.providers` once, at
`AuthenticationModule.start`, through `SettingsService` so the secret is stored as a row secret, and
records `signin.seededFromEnvironment` so an operator who deletes the Google row does not find it back
after the next restart. It never writes over a stored list, even an empty one, and never stops the
boot. Nothing else reads the variables. The seed, and the variable's entry in
`scrub.process.env.ts`, go in a later release.

## Apps that connect as somebody: the station as an OAuth authorization server

The other direction: not the station signing people in through somebody else's provider, but an app
(a Claude connector, first) signing in to the station as one of its people. The flow is
`@maroonedsoftware/authentication`'s `OAuthAuthorizationServer`; `modules/oauth` supplies the stores,
the addresses and the switches, and nothing happens until `oauth.enabled` is on.

**The issuer is the origin** (`OAuthOptions`), so the RFC 8414 and RFC 9728 documents are at the
root, which every edge forwards with the path kept (`docs/internals/deployment.md`). The MCP endpoint
is the resource, `<origin>/api/mcp`.

**A grant is a session.** Approving on the console's `/oauth/authorize` stashes nothing new about the
person: the token endpoint mints an ordinary session for them, with their login claims and factors,
`claims.oauth` naming the app, the resource and the grant, and the resource as its **audience**. The
JWT issuer asks for that audience at the MCP path and the station's own everywhere else
(`issuers/jwt.authentication.issuer.ts`), so the app's token is refused by every other route and a
console session is refused at `/mcp`, with no route having to ask. The `oauth.grant` policy on the MCP
route is the second lock: it reads the grant, and refuses everything while the switch is off. A grant
session lasts seven days (`OAUTH_SESSION_LIFETIME`); the app refreshes it, and a refresh is refused
for a revoked grant or the wrong client.

**A grant has a ceiling, the one an API key has, and its tuples are never stored.** The session acts
as the person, and `UserActor.grant` narrows it to the station scopes the grant holds (`view`,
`manage`), read through `delegatedGrants` by every check that narrows a key: the platform policies,
`AccessControlService`, `hasPlatformRole`. `requireAuthentication` refuses a grant outright, as it
refuses a key, so an app can never approve another app or mint a key, and the step-up policy refuses
one too, because a grant's session carries the factors of the session it was approved from, with their
original times, and would otherwise pass a step-up for a while after approval. The ceiling comes from
the `oauthgrant` namespace in `core.perm`, a copy of `apikey`, so a grant can never exceed its owner.
Its tuples are DERIVED from the grant row's `scope` column by `DeadairPermissionsTupleRepository`
(`oauth.grant.tuples.ts`) rather than written, because the OAuth library already writes that column at
every code exchange and rewrites it on every re-approval, and a stored copy would have to be kept in
step with it. The middleware reads it by `claims.oauth.grantId` on each request, so approving an app
again with less narrows every session it already holds. Writing a tuple in that namespace throws.

**The person chooses the scope on the consent page, whatever the app asked for.** Read only is the
default, read and manage the other choice, in the words an API key uses (`shared/access.words.ts`).
`OAuthConsentService.approve` requires at least one, adds `view` to `manage`, and hands the library
`['mcp', ...chosen]` as `AuthorizationConsent.scope`, which replaces the requested scope in the grant,
the session's `oauth` claim and the token response alike (RFC 6749 §3.3 lets the server issue a scope
other than the one requested on the resource owner's instructions). Every grant from before there was
a choice was approved as the whole account, and migration 0053 gave it both scopes, which is what it
already meant. To change what an app may do, the person disconnects it and approves it again.

**The RFC endpoints are hand-written** (`routes/oauth.protocol.router.ts`), because their status
codes and error bodies are the RFCs' and a generated route cannot produce them. The console's half
(consent, registered apps, connected apps) is generated from `data/contracts/oauth`. Consent takes the
app's query string as one string, since a generated query schema is strict and would refuse any
parameter an app adds.

**Two things ServerKit does that would otherwise break it.** Its authentication middleware deletes
`Authorization` from every request before routes run, so a client authenticating to the token endpoint
with HTTP Basic has its header set aside first (`oauth.client.credential.middleware.ts`). And a 401 is
thrown rather than returned, so the RFC 9728 `resource_metadata` pointer is added by a middleware that
catches it just inside the error middleware (`oauth.challenge.middleware.ts`).

**Clients.** Claude registers itself (RFC 7591) on every connection, so a self-registered client lapses
ninety days after its last use and a nightly job deletes it. Claude Code identifies itself with a
metadata document on its own site, fetched and cached, never stored, which is why a grant's
`client_id` is not a foreign key. An operator can register one by hand, with a show-once secret, and
withdrawing any client ends every grant of it and every session held through them.

**Nothing in the cache-holding pieces may be a singleton**: the Redis cache is scoped, and
`tests/modules/oauth/oauth.module.test.ts` builds the module with a scoped stand-in so the captive
dependency fails the suite rather than the boot.

## What a connected app can do: the MCP tools

**Everything on the MCP surface lives in `apps/api/src/mcp`**: the route, the tools ContractKit
generates from operations a contract flags `mcp: { description: ... }`, and the few written by hand
(`whoami`). `modules/mcp/mcp.module.ts` is only their wiring. The route stays hand-written
(`emitRouter: false`), because the generated one guards the mount with a bare session check and this
one must keep `oauth.grant`.

**Every tool acts as the caller, and that is not the default.** The tools are singletons built at
boot, when the scoped `AuthorizationContext` holds the startup actor, so a tool that
constructor-injected its service and `PolicyService` would refuse every `platform.*` check and
answer every `requireUser()` with a 403. `resolve: "perCall"` in `contractkit.config.json` makes each
generated tool resolve both from the request's container on every call, and the route hands that
container over (`container: ctx.container`). A hand-written tool does the same: `whoami` resolves
`AuthorizationContext` per call. `tests/mcp/mcp.router.test.ts` builds the tools once and serves two
callers, which is what fails if either half is dropped.

**A refusal is a tool result, not a protocol error.** Every tool is wrapped by `explainToolErrors`,
so a 403 reaches the model as "this caller is not allowed to do that" and a validation failure as
the list of fields to ask for, instead of a JSON-RPC error that ends the call. Only an error that is
not an `HttpError` still fails the protocol.

**Every other operation is one search away, not one listing away.** About two hundred operations
would cost every conversation the whole API in `tools/list` before it asked anything, so only a
handful are listed. `catalog: true` generates a handler for every operation a tool can serve, held
apart from the listed ones as `McpToolCatalog`, and `search_api` reaches them in two modes: a query
answers a compact index of at most 25 (the name, one sentence, whether it reads or changes something,
and the tier it needs), and a name answers that one operation in full with its argument schema. The
index is filtered to what the caller may actually use, their role AND their grant (`mayUse` in
`src/mcp/api.catalog.ts`), so a view grant is never offered something it would be refused. Everything
it says comes from the generated definitions themselves: the description, the hints, and the policy
under `_meta['contractkit/security']`, which is also why a test fails if any operation ever falls back
to the MFA default a contract with no security gets. An operation is kept out with `mcp: exclude` in
its contract: signing in and credentials, connected apps and their consent, first-run setup, plugin
and fetcher sign-in and configuration, station settings (which hold sign-in providers), log files
(which can hold the bridge secret), and the two long model calls, which run outside the request
transaction over HTTP and would hold a pooled connection for minutes here.

**`call_api` runs what `search_api` found, through the same handler a listed tool would be.** It
looks the name up in `McpToolCatalog` and calls the generated handler with the caller's context, so
the operation's policy, validation and service run exactly as they do for a listed tool, and the
catalog is wrapped by `explainToolErrors` too, so a view grant asking to skip gets "it needs the
`manage` scope" rather than a protocol error. What it adds is the shape of the answer: `fields` keeps
only those keys of each record, and an answer over 12,000 characters keeps as many whole records as
fit and says how many there were (`truncated: { shown, of }`), rather than cutting a record in half or
handing a model a whole table. It says it is destructive, since what it runs may be, and its
description tells the model to confirm before an operation whose index entry is. Every call is logged
once at `info` (`mcp: call_api`, with the operation, the grant, `ok` or `refused`, and the time), which
is what the listed set is meant to be grown from: an operation called through here often enough
deserves an `mcp` block of its own.

**A description is written for the model**, in the operation's `mcp` block rather than its `#`
comment: what the tool answers, and when to use it rather than its neighbour. The hints come from
the HTTP method unless the block says otherwise (a `GET` is read-only and idempotent, a `DELETE`
destructive), so an operation whose method misdescribes it has to say so.

## Party guests

**A guest is an actor of its own kind, not a listener without a password.** Somebody who joins a party
with its pass (`docs/internals/messaging.md` § "Requests") gets a `deadair.actors` row of type `guest`
and a session whose claims say `actorType: 'guest'` and name the pass. The middleware builds a
`GuestActor` from it, and only while the pass is live: an ended or expired pass, or a guest switched off,
revokes the session and answers 401, on every path, bootstrap routes included, since a guest has no
sign-in to come back through.

**What a guest may do is one policy, `requests.ask`, on four routes.** Granting a guest the
`listener` role would have been one line and wrong: `platform.view` is every read the station has,
settings included. A guest holds no role, so every `platform.*` gate refuses it, `requireUser` and
`requireAuthentication` both refuse it, `oauth.grant` refuses it on audience, and
`AccessControlService.require` denies it explicitly, because falling out of that switch ALLOWS.
`tests/routes/guest.reach.test.ts` reads every router and fails on any route that names a policy
which might admit a guest, names `requests.ask` beyond the request search, create, mine and insist, or admits
any session (`policy: none`) without having been reviewed for what a guest could do with it. The
factor method on a guest session is the library's `apikey`, because its method list is closed and a
pass is a bearer secret the guest possesses; that also keeps it from ever counting as a recent or
second factor.

## Working on it locally

`docker compose --profile sso up -d oidc` starts `navikt/mock-oauth2-server` on port 3080. Add a
provider with issuer `http://localhost:3080/default` and any client id and secret. Its login form
takes any username and optional JSON claims: `{"email": "alice@example.com", "email_verified": true}`
is somebody the allowlist can name, and no address is somebody it cannot. The issuer is derived from
the Host header, so the API under `pnpm dev` and the browser both reach it as `localhost:3080`. An
http issuer is allowed only because it says so, and the library logs a warning for it.
