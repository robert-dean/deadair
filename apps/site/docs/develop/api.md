---
title: Build on the API
sidebar_position: 3
description: A key, a first request, and the typed clients. Everything the console does, your code can do.
---

# Build on the API

Every station serves the same HTTP API. The console is built on it, and so are the Android, desktop
and iOS listeners, so anything they do is something your own code can do: read what is playing, put
a record on, skip, stop, read the history, write a break.

You need a station and about two minutes. Nothing here needs a checkout of the repository.

## Where it is

The API is served under `/api` on the station's one published port, so on a default install it is
`http://localhost:8080/api`. Every path below is relative to that.

## One request that needs nothing

`GET /nowplaying` is the only route with no sign-in at all, and it answers cross-origin requests from
any page, so a now-playing widget on your own site is a `fetch` and no server of yours:

```bash
curl http://localhost:8080/api/nowplaying
```

```json
{ "station": "Deadair", "onAir": false, "listeners": 0, "mounts": [{ "format": "mp3", "path": "/live.mp3", "bitrateKbps": 128 }] }
```

That is also how the [station directory](/community/stations) shows what each listed station is
playing while you look at the page.

## A key, for everything else

In the console, open **Settings → Security** and create an API key. Give it a name and a scope:

- **`view`** reaches every route the console reads with.
- **`manage`** reaches the ones that change something, and includes `view`.

The token is shown once, when it is created or rotated, and the station keeps only a fingerprint of
it. It starts with `da_`, and it goes in the same header a session token does:

```bash
curl -H 'Authorization: Bearer da_…' http://localhost:8080/api/director/air
```

A key acts as the account that made it and never does more: a listener's key can only read, whatever
scope it was given, and an account that loses a role loses it from every key on the next request. A
route your scope does not cover answers 403 and says which scope it wanted:

```
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="manage"
```

No key can sign in, change how its account signs in, or create, rotate or revoke keys. Those need the
person.

## The typed client

```bash
npm install @deadair/sdk
```

The SDK is generated from the same contracts the station serves its routes from, so a method, its
parameters and the shape it answers are the station's own. It carries the station's version: use the
one that matches the station you talk to.

```ts
import { DeadairSdk } from '@deadair/sdk';

const sdk = new DeadairSdk({
    baseUrl: 'http://localhost:8080/api',
    headers: () => ({ Authorization: `Bearer ${process.env.DEADAIR_KEY}` }),
});

const now = await sdk.nowplaying.getNowPlaying();
console.log(now.onAir && now.track ? `${now.track.artist} - ${now.track.title}` : 'off air');
```

`headers` is a function, called once per request, so a token you replace later is picked up without
building a new client. It is an ES module and runs anywhere with a global `fetch`.

A password grant works too, for a client signing in as a person rather than carrying a key:
`sdk.authentication.requestToken({ grant_type: 'password', username, password })`, which answers
either a token or `result: 'mfa_required'` for an account with a second factor.

## In another language

The station publishes an OpenAPI 3.1 document at
[`/openapi.yaml`](https://deadair.radio/openapi.yaml), which every generator reads:

```bash
npx @openapitools/openapi-generator-cli generate -i https://deadair.radio/openapi.yaml -g python -o ./deadair-client
```

Three clients are generated from the contracts and kept in the repository already, and are what the
listener apps are built on:

| Language | Package |
| --- | --- |
| Kotlin (Ktor) | `packages/sdk-kotlin` |
| C# (System.Text.Json) | `packages/sdk-csharp` |
| Swift (Codable) | `packages/sdk-swift` |

## What to read next

- The [API reference](../api-reference/index.md) is every route, generated from the contracts, with
  what each one needs and answers.
- [Listing your app](/community/apps) puts what you built in front of other operators.
- [Connecting Claude](../features/connect-claude.md) covers the other way in: an app that signs in
  with OAuth and acts as whoever approved it, rather than holding a key.
- If what you want is for the station to *do* something new rather than to be driven from outside,
  that is a [plugin](../plugin-development/index.md) instead.
