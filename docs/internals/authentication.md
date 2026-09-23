# Internals: signing in through an identity provider

Where the providers come from, who may join through one, how a link is made and undone, and what
the station does with the Google variables it used to read. The always-loaded index is
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
the provider it began with.

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

**An account with no password cannot use the listener apps**, which sign in with a password and an
authenticator code. Password sign-in stays.

## The Google variables

`GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET` and `GOOGLE_OIDC_ISSUER` used to build the only
provider there was. `seedSigninProvidersFromEnv` copies them into `signin.providers` once, at
`AuthenticationModule.start`, through `SettingsService` so the secret is stored as a row secret, and
records `signin.seededFromEnvironment` so an operator who deletes the Google row does not find it back
after the next restart. It never writes over a stored list, even an empty one, and never stops the
boot. Nothing else reads the variables. The seed, and the variable's entry in
`scrub.process.env.ts`, go in a later release.

## Working on it locally

`docker compose --profile sso up -d oidc` starts `navikt/mock-oauth2-server` on port 3080. Add a
provider with issuer `http://localhost:3080/default` and any client id and secret. Its login form
takes any username and optional JSON claims: `{"email": "alice@example.com", "email_verified": true}`
is somebody the allowlist can name, and no address is somebody it cannot. The issuer is derived from
the Host header, so the API under `pnpm dev` and the browser both reach it as `localhost:3080`. An
http issuer is allowed only because it says so, and the library logs a warning for it.
