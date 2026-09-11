---
title: The example, file by file
sidebar_position: 5
description: A complete charts plugin, from its package to its tests, and the one mistake every chart source makes that it is built to avoid.
---

The example follows Apple Music's most-played songs in one country, as a chart a station can air. It is short enough to read in one sitting, and it is built exactly the way a plugin from outside the repository is, which deadair's CI checks on every change. The source is in [`examples/plugins/apple-music-charts`](https://github.com/robert-dean/deadair/tree/main/examples/plugins/apple-music-charts).

## The package

`package.json` names the entry in `deadair.plugin`, declares the SDK and zod as peers, and has no `dependencies` at all. `tsup.config.ts` builds `src/index.ts` into a single ES module and needs no settings to leave the peers out. [Packaging and installing](./packaging.md) explains why each of those matters.

`src/index.ts` is the whole of what the station imports:

```ts
export default definePlugin(appleChartsManifest, () => new AppleMusicChartsPlugin());
```

The factory runs every time the plugin starts, which includes every time an operator saves its settings. Keep it cheap, and put setup in `onLoad`.

## The manifest

`src/apple.charts.manifest.ts` says what the plugin is and what it needs.

- **`id`** is `example.apple-music-charts`. Reverse-DNS, and never changed once released.
- **`capabilities`** is `['charts']`, so the station will call `listCharts` and `fetchChart`.
- **`apiVersion`** is `^1.0.0`. See [versioning](./versioning.md).
- **`permissions.network`** names `rss.marketingtools.apple.com`, the only host it reaches. `host.fetch` refuses any other.
- **`configFields`** holds one `select`, the country. The console draws it with no code from the plugin.
- **`configSchema`** is the zod schema the station validates a saved form against, with the default filled in.

## The plugin

`src/apple.charts.plugin.ts` extends the SDK's `Plugin` class, which gives it `this.host` once the station has started it and a place to put setup and teardown.

`onLoad` reads the country out of the settings, parsed through the manifest's own schema, and remembers it. `listCharts` offers one chart, named for that country. `fetchChart` asks Apple for the feed through `host.fetch`, turns each entry into a `ChartEntry` and trims the list to the number asked for. `testConnection` fetches the same feed and names the song at number one, which is what an operator sees after pressing Test connection.

Four details are worth copying into any plugin.

- **Take the host once, before the first `await`.** Saving a plugin's settings restarts it, and a request in flight at that moment must not reach for `this.host` afterwards and find it gone. So each method starts with `const host = this.host` and uses that.
- **An id you never offered gets an empty answer**, not an error. It means the menu moved under the caller, which is not a fault in the plugin.
- **A refusal is a `PluginError` with a code.** A failed response is cancelled rather than read, and becomes `unavailable`, `rate_limited` or `upstream` according to its status, so the station knows whether to retry.
- **A request for a past edition gets the current one.** Apple has no archive, and a nearly-right chart is a usable hour where an error is silence.

## The one thing chart sources get wrong

A station matches a chart entry on its title and its lead artist, and nothing else. Apple's feed does not have a lead artist. It has `artistName`, which is a credit line: `HUGEL, Imael Angel & Ultra Naté` is one field. Hand the station that string and it names a record correctly and finds nothing, and the record is dropped as not in the library.

Splitting the credit on its punctuation is the obvious fix, and it is wrong. A comma is part of `Tyler, The Creator`, and an ampersand is part of `Simon & Garfunkel`. Split those and the station goes looking for an artist called `Tyler`.

The feed does say who the lead is, just not in that field. Beside the credit is `artistUrl`, the lead artist's page, and it ends in a slug of their name:

```text
HUGEL, Imael Angel & Ultra Naté    https://music.apple.com/gb/artist/hugel/978839124
Sam Fender & Olivia Dean           https://music.apple.com/gb/artist/sam-fender/1213989970
```

So `src/apple.feed.ts` takes the shortest run of names at the start of the credit whose slug matches the page, and makes everyone after it `featuring`, which the station shows and never matches on. `Tyler, The Creator & Kali Uchis` against a page ending in `tyler-the-creator` keeps the comma, because `tyler` alone does not match. When nothing matches, the whole credit stays as the artist: a record the station cannot find is a better outcome than a record it finds under somebody else's name.

The title is left exactly as Apple spells it, `(feat. …)` included. That is how the music services spell it too, and the title is where the station expects a featured artist.

The general lesson is to use what a source says about identity rather than guessing at its formatting. Every source has something: a MusicBrainz id, an artist page, a separate field for featured artists.

## The tests

`tests/apple.feed.test.ts` pins the credit splitting, including the names that must not be split. `tests/apple.charts.plugin.test.ts` runs the plugin against the SDK's fake host: it checks the address asked for, the ranking and the split credits, the limit, the empty answer for an unknown chart, the error code for a 503, and both answers from `testConnection`. See [testing](./testing.md) for the fake host.
