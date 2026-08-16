# Deferred: service actors for the machine callers

**As of:** 2026-08-08, just after `listener.credential.middleware` landed (896db1f).

> **Stale as of 2026-08-16, and not lightly.** Two of the three machine callers this file is about
> no longer exist in the form it describes. Icecast's `listener_add`/`listener_remove` hooks are
> gone, along with `listener.credential.middleware`, `stream.listenerHooks` and
> `POST /playout/bridge/listener`: the audience is read from `/admin/eventfeed` and a poll instead,
> so nothing holds a listener's connection open on a blocking call to this app. That takes with it
> the second and strongest of the four reasons below for not building this — "`listener_add` is a
> blocking call on the listener's own connection" — which was the only one about a path where two
> Postgres round trips would have been unaffordable. The middleware section under Related describes
> a file that is not in the tree; only `bridge.secret.middleware.ts` remains.
>
> What survives unchanged: one shared secret across both directions, the credential not being
> per-caller, scheme registration being global, and sessions being the wrong shape for a caller that
> presents a credential on every request and holds nothing between them. **Re-scope before planning
> from this**, because the remaining machine callers are Liquidsoap and the Spotify shim, which is
> two rather than three, and the trigger this file names (a third machine caller) has moved.

Three things inside the stack call the API as themselves rather than on behalf of an operator:
Liquidsoap (`POST /playout/bridge/aired`), Icecast (`POST /playout/bridge/listener`), and the Spotify track shim
in the other direction. All of them present the same static string, and none of them is an actor.
This file is the design for making them actors, and the reason it was not done when the question
came up.

## What the tree does today

One secret, both directions. `StreamService.settings().playoutBridgeSecret` is read once in
`PlayoutModule.ready` and pushed into `LiquidsoapEndpoint.useSecret`, and the same value is handed
to `SpotifyShimClient.useSecrets` and materialized into `radio.env`. `radio.liq` checks it on its own
control API; `PlayoutService.requireBridgeSecret` checks it, in constant time, on ours.

The bridge routes are `operation(internal)` in `data/contracts/playout/playout.ck`: they generate a
router but no SDK method, they carry no `policy`, and they take the secret as a declared
`PlayoutBridgeHeaders` field rather than through authentication. Icecast cannot set a header of its
own, so it sends the secret as HTTP basic and
`apps/api/src/server/middleware/listener.credential.middleware.ts` moves it onto `x-playout-secret`
before ServerKit's authentication middleware deletes `Authorization`.

`Actor` is `user | system | vendor` (`apps/api/src/modules/permissions/authorization.context.ts`).
Both bridge callers land in the unauthenticated branch of `authorizationContextMiddleware` and are
classified `{ kind: 'system', source: 'http' }`, which is to say: not distinguished from each other,
or from anything else that arrives without a bearer.

## What the design is

A fourth actor kind, `service`, backed by its own credential and its own permission tuples, so each
machine caller authenticates as itself and is separately revocable.

`@maroonedsoftware/authentication` already ships the auth half: `BasicAuthenticationHandler` decodes
the credential and delegates to a `BasicAuthenticationIssuer` you implement and register in the
container (`verify(username, password) -> AuthenticationSession`). The username, ignored today, is
what names the caller. So `icecast:<secret>` and `liquidsoap:<secret>` stop being the same
credential presented twice and become two identities.

What has to exist around it:

- A store for service credentials: hashed, rotatable, one row per caller, and readable at boot in
  time to seed `radio.env` and `icecast.xml`.
- A `ServiceActor` variant on the `Actor` union, and a branch in `authorizationContextMiddleware`
  that builds one. The `existsActive` check there is written against `ActorsRepository` and human
  logins; a service actor needs the equivalent against its own store, not a person row.
- Tuples that say what each caller may do, and a `policy` on the bridge operations to replace the
  hand-rolled `requireBridgeSecret`.
- Rotation that does not take the station off air: both halves of the bridge hold the secret in
  memory (`LiquidsoapEndpoint`, `SpotifyShimClient`) and Liquidsoap holds its copy from `radio.env`,
  so a rotation is a settings write, a re-materialize and a reload of two processes, in an order
  nothing has worked out yet.

## Why it was not built when it came up

**The credential is not per-caller yet.** "Icecast as its own actor" reads as an auth-plumbing
change and is not one: while Liquidsoap and Icecast share a string, giving one of them an identity
gives the other the same identity for free. Splitting the secret comes first, and it touches
settings, `radio.env`, `icecast.xml` and the shim.

**`listener_add` is a blocking call on the listener's own connection.** Icecast holds the client
until `POST /playout/bridge/listener` answers, which is why `PlayoutService.noteListener` does no database
work, takes no lock and returns a constant. Routing it through authentication as it stands adds, per
listener connect, an issuer verify, a session materialization, and then the `existsActive` query and
platform-role tuple read that `authorizationContextMiddleware` performs. Two Postgres round trips on
the path that decides whether somebody hears the station. Any design here has to keep that path
free of I/O: verify against an in-memory credential seeded at boot, and resolve the actor without
touching the database, or leave the route where it is.

**Scheme registration is global.** Handling `basic` makes every route in the API accept basic, so
the secret stops being a credential for one gate and becomes a credential for the whole API,
narrowed only by tuples. That is the right shape once the tuples exist and each caller holds its
own secret. It is a strictly worse shape while one shared string would inherit whatever the union of
those permissions turns out to be.

**Sessions are for logins.** `AuthenticationSession` carries an expiry, factors and a family id, and
lives in Redis. Icecast presents its credential on every request and holds nothing between them, so
a service actor should mint nothing and store nothing: the session it produces is derived from the
credential each time, or the concept is being borrowed for something it does not fit.

## When to build it

When there is a third machine caller, or the first time a bridge credential has to be rotated
without taking the other one down. Until then one shared secret checked in constant time on two
routes is honestly described by the code that does it, and the middleware above is the whole cost of
Icecast's inability to set a header.

If the render pipeline lands first (see
[director-and-lineups.md](director-and-lineups.md)), it arrives with its own machine caller and is
the natural moment: do the credential split, then the actor kind, then move the bridge routes onto a
policy, in that order. Each step leaves the station on air.

## Related

- `apps/api/src/server/middleware/listener.credential.middleware.ts` for why the basic credential is
  moved rather than handled, and the two alternatives that were rejected.
- `stream/README.md` for the lease and the listener hooks, including `stream.listenerHooks` for an
  Icecast built without libcurl.
- `.claude/skills/contractkit/SKILL.md` on `operation(internal)` and why the webhook policy shape
  does not fit these routes.
