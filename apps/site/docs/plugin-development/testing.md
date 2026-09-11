---
title: Testing a plugin
sidebar_position: 3
description: Testing plugin code against the fake host the SDK ships, and checking that a station would load what you built.
---

A plugin reaches the world only through the host it is handed, so the thing to replace in a test is the host. The SDK ships one for that, which is the same double the twelve bundled plugins are tested with.

## The fake host

`createFakePluginHost` comes from `@deadair/plugin-sdk/testing`, an entry of its own so that nothing a station loads depends on a test runner. It is written for vitest.

```ts
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';

const host = createFakePluginHost();
host.seedConfig({ country: 'gb' });
host.queueResponse({ body: JSON.stringify(feed) });

const plugin = new AppleMusicChartsPlugin();
await plugin.init(host);

const entries = await plugin.fetchChart({ chartId: 'most-played', limit: 10 });
expect(host.calls[0]?.url).toBe('https://rss.marketingtools.apple.com/api/v2/gb/music/most-played/100/songs.json');
```

What it gives you:

- **`queueResponse`** scripts the next `host.fetch` answer: a status, headers and a body. Replies are handed out in order, and a fetch with nothing queued throws, so a request you did not expect fails the test.
- **`setFetchImpl`** replaces the queue with a function, for a test that depends on how many calls came before, such as a token refresh after a 401.
- **`calls`** records every fetch, with its URL, method, headers and body.
- **`seedConfig`** and **`seedSecret`** set what `host.config.get()` and `host.secrets.get()` answer.
- **`seedStorage`**, **`getStorageEntry`** and **`storageKeys`** reach the plugin's storage directly, so a test can arrange state and read it back without going through the code under test.
- **`seedRemainingMs`** sets what `host.remainingMs()` reports, for a plugin that sheds work when the call is nearly out of time.
- **`seedTokens`** and **`getVaultTokens`** do the same for OAuth tokens.

The logger, storage and every other host method are vitest mocks, so `expect(host.logger.warn).toHaveBeenCalled()` works as you would expect.

## What to test

The capability's own rules are the ones worth pinning, because they are where a plugin that looks right goes wrong on a station. Each capability's page in [the contract](./contract.md) lists its own, and two apply to most of them:

- **A failure the station can act on is a `PluginError` with a code.** A 429 is `rate_limited` with its `Retry-After`, a key the service rejected is `auth`, and an upstream that is down is `unavailable`. `pluginCodeForStatus` answers the status half of that for you. A bare `Error` is treated as a fault in the plugin.
- **An ordinary empty answer is not a failure.** A chart id you do not recognise is an empty chart, and a place nobody has heard of is no weather. Where a refusal really is about the thing asked for, `not_found`, `forbidden` and `unsupported` say so, and the station does not count them against the plugin. Every other failure does, and three in a row take the plugin off the station until it recovers.

## Will the station load it

A plugin can build and pass every test and still be quarantined, for a `deadair.plugin` that points at the wrong file, a library left unbundled, or a manifest the station rejects. The deadair repository has a check that answers with the station's own loader: it installs your built plugin into an empty plugins directory, links the station's SDK and zod beside it as a station does, and runs discovery.

From a checkout of the repository, after `pnpm install` and `pnpm build`:

```bash
pnpm --filter @deadair/api plugin:prove /path/to/my-plugin --expect com.example.my-charts
```

It prints what the station would say about the plugin, and exits non-zero unless the plugin was loaded with the id you expected. deadair's own CI runs it on the example plugin for every change, which is how the path an outside plugin takes is kept working.
