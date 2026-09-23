---
title: 'API Reference'
sidebar_position: 0
mdx:
    format: 'md'
---

Every deadair station serves the same HTTP API. The console is built on it, and so are the Android,
desktop and iOS listeners. The pages in this section are generated from the station's contracts
([`apps/api/data/contracts`](https://github.com/robert-dean/deadair/tree/main/apps/api/data/contracts))
whenever they change, so they describe the `main` branch.

## Where it is

Every station is self-hosted, so the address is your own. The API is served under `/api` on the
station's one published port, which on a default install is `http://localhost:8080/api`. The paths
on these pages are relative to that prefix: `GET /catalog/albums/{id}/enrichment` is a request to
`http://localhost:8080/api/catalog/albums/{id}/enrichment`.

## Signing in

Ask for a token with [Request token](./authentication/request-token.md), sending a
[password grant](./models/authentication/password-authentication-request.md): `grant_type` set to
`password`, your email address as `username`, and your password. Then send the `access_token` it
returns on every request:

```
Authorization: Bearer <access_token>
```

An account with a second factor enrolled verifies it through the other Authentication routes as
part of signing in.

### API keys

For a script or an integration, use an API key rather than a password. Create one in the console
under Settings → Sign-in and security, or with [Create API key](./authentication/create-api-key.md) from a
signed-in session, and send it the same way:

```
Authorization: Bearer da_…
```

A key is shown once, when it is created or rotated, and the station keeps only a fingerprint of it.
It acts as the account that made it, with one of two scopes: `view` reaches the routes that need
`platform.view`, and `manage` reaches the ones that need `platform.manage` as well. A key never does
more than its account: a listener's key can only read, whatever it was given, and an account that
loses a role loses it from every key on the next request. A route a key's scope does not cover
answers 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="manage"`, so a client
can tell a key that is too narrow from an account that may not.

No key can sign in, change how its account signs in, or create, rotate or revoke keys. Those need
the person.

## Permissions

Each page says what its route needs. Most reads need the `platform.view` policy, which both the
listener and admin roles grant, and most writes need `platform.manage`, which only admin grants.
`policy: none` means any signed-in account, and `public` means no sign-in at all.

## Clients

The same contracts generate a typed client for TypeScript, published to npm as
[`@deadair/sdk`](https://www.npmjs.com/package/@deadair/sdk). Each page names its method for the
route. It carries the station's version, so use the one that matches the station you talk to:

```bash
npm install @deadair/sdk
```

They also generate the Kotlin (`packages/sdk-kotlin`), C# (`packages/sdk-csharp`) and Swift
(`packages/sdk-swift`) clients the listener apps are built on. Those are in the repository and not
published to a package registry.

For any other language, the same API is described as an OpenAPI 3.1 document at
[`/openapi.yaml`](pathname:///openapi.yaml), generated alongside these pages, which most client
generators and API tools will read.

Routes that only the station's own parts or an identity provider call are left out of this
reference.
