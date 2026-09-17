# @deadair/plugin-ytmusic

YouTube Music as a deadair music provider: search, and the playlists on your account.

**This plugin is not loaded by any station.** It is built, tested and shipped inside the image, and
deliberately left out of `bundledPluginDirs` in `apps/api/src/modules/plugins/plugins.bundled.ts`.
The line goes back when the audio half exists.

**It cannot play anything, and that is the whole shape of this version.** The plugin declares
`catalog` and not `stream`, so records found here are searchable and importable and the running
order skips them. Nothing is half-wired: the host asks `asStreamPlugin` for a URL, gets nothing,
moves on, and holds nothing against the plugin.

## Why there is no audio

`resolveStreamUrl` is specified to return "a complete URL that carries its own authentication,
because the player fetches it with no headers from us". A YouTube media URL is bound to the client
identity that minted it: fetching it needs a matching `User-Agent`, and for some identities `Origin`
and `Referer` too. Liquidsoap sends its own headers and cannot be told otherwise per item, so there
is no URL this plugin could return that would work. Serving one takes a header-fixing range proxy
running beside the station. That is a separate piece of work, argued in
[discussion #49](https://github.com/robert-dean/deadair/discussions/49).

### What happens if you import a playlist anyway

Search costs nothing: a result you do not act on is never catalogued. Importing a playlist is
different, and worth knowing before you do it.

An imported record becomes a real catalog row with a binding to this plugin, and nothing in the
rotation draw asks whether the owning plugin can actually stream — it filters on whether the
provider still offers the copy, which this one does. So the record is drawn like any other, and then:

1. The station asks this plugin for a URL and gets nothing.
2. The fetch fails, and the copy earns a failure row and a doubling backoff.
3. The director drops it from the running order **before its slot** and records
   `item.unavailable` — "the station cannot get hold of its audio."
4. After four consecutive failures the copy is benched and stops being drawn at all.

Nothing goes silent: the drop happens over the warm window, which is long enough for the generator
to be asked for a replacement. But each imported record costs four failed fetches and four
operator-facing activity events on its way to being written off, so a large playlist imported today
is a large amount of noise for nothing. Until the audio half exists, this plugin earns its place as
a SEARCH source.

## Setting it up

One setting: **Cookie**. There is no OAuth option to offer instead, because Google withdrew it for
this service in late 2024, and a pasted browser cookie is what every server-side implementation uses now.

1. Sign in to <https://music.youtube.com> in a browser.
2. Open the developer tools, **Network** tab, and reload the page.
3. Select the first request (the document), find **Cookie** under Request Headers, and copy the
   whole value.
4. Paste it into the plugin's Cookie field and press **Test connection**.

It is a live session: treat it as a password. The station stores it encrypted and never reads it
back into the form.

### It will expire, and the plugin will say so

There is no refresh. The cookie dies on the account's own schedule and you paste a fresh one.

The plugin goes out of its way to make that legible, because the failure is otherwise invisible:
**search keeps working when the cookie is dead.** YouTube serves search to signed-out callers, so a
station with an expired cookie would go on returning results while the library silently went dark:
a rotation quietly thinning with nothing on the plugin's card to say why. So the credential is
checked at startup and behind **Test connection** by asking the upstream which account it belongs
to, and a failure is reported as an authorization problem rather than as a fault at YouTube.

It asks about the ACCOUNT rather than reading the library, and that distinction is load-bearing: an
empty library section answers exactly the same parse failure a signed-out page does, so a
library-based check refuses a perfectly good cookie belonging to an operator who has no playlists
yet.

## What the records look like

- **No ISRC.** This source publishes none. It is the best cross-provider join key, so records
  imported from here are second-class for deduplication against the same recording from Spotify or
  Navidrome, and for the MusicBrainz enrichment path, which is cheapest when it has one.
- **No year** on search results, so a search narrowed to a period returns nothing rather than
  returning unfiltered records with nothing marking them.
- **No popularity**, because the source has no such number.
- **Explicit records are marked**; unmarked ones are reported as unknown rather than as clean.

## Development

```bash
pnpm --filter @deadair/plugin-ytmusic test
pnpm --filter @deadair/plugin-ytmusic build
```

Every request goes through `host.fetch`, so the single hostname in `permissions.network` is the
truth about where this plugin connects. That is asserted in `tests/ytmusic.fetch.test.ts` rather
than assumed, because it is a property of `youtubei.js` that a version bump could take away
silently.
