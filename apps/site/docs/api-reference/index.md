---
title: 'API Reference'
sidebar_position: 0
mdx:
    format: 'md'
---

Every deadair station serves the same HTTP API. The console is built on it, and so are the Android
and desktop listeners. The pages in this section are generated from the station's contracts
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

## Permissions

Each page says what its route needs. Most reads need the `platform.view` policy, which both the
listener and admin roles grant, and most writes need `platform.manage`, which only admin grants.
`policy: none` means any signed-in account, and `public` means no sign-in at all.

## Clients

The same contracts generate a typed client for TypeScript (`packages/sdk`), Kotlin
(`packages/sdk-kotlin`) and C# (`packages/sdk-csharp`), all in the repository and none published
to a package registry yet. Each page names the TypeScript client's method for its route.

For any other language, the same API is described as an OpenAPI 3.1 document at
[`/openapi.yaml`](pathname:///openapi.yaml), generated alongside these pages, which most client
generators and API tools will read.

Routes that only the station's own parts or an identity provider call are left out of this
reference.
