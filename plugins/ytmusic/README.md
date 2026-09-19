# @deadair/plugin-ytmusic

YouTube Music as a deadair music provider: search, and the playlists on your account.

Audio comes from `ytaudio/`, a bundled Python service on yt-dlp that turns a track
into a URL the station fetches itself. **Nothing proxies bytes**: the URL is an
ordinary HTTPS one carrying its own authentication, so the station caches it and
serves it to the player exactly as it does a Navidrome URL.

## The audio is resolved signed out

The cookie is for the catalog: search, your library, your playlists. **It never reaches the
resolver.** Every resolve is signed out, because signed in YouTube serves nothing the station can
fetch. Measured 2026-09-19 on the operator's own account through yt-dlp:

| Resolve | Formats offered | Fetchable |
| --- | --- | --- |
| signed out | 5 | yes, and it aired |
| signed in, no JS runtime | 0 | no |
| signed in, with Deno | 4 | no, every one answered 403 for want of a proof-of-origin token |

YouTube currently forces its segment streaming protocol on signed-in sessions, and the yt-dlp
tracker reports the same for Music Premium accounts
([#14390](https://github.com/yt-dlp/yt-dlp/issues/14390)), so paying does not change it.

**What that costs.** A record that only an account may play (age-gated, members-only,
Premium-only) does not play from here. The station skips it and holds nothing against the plugin.
It is also the path YouTube is most motivated to close: if every record stops playing at once, a
yt-dlp update is the first thing to try.

## Why the audio is not resolved here

Measured 2026-09-17: every client identity `youtubei.js` offers answered with
YouTube's adaptive segment protocol and no plain URL on any format. yt-dlp finds
rungs it does not, and keeps finding them on somebody else's schedule. The
alternative was implementing that protocol and its attestation in this plugin and
owning every break. See
[discussion #49](https://github.com/robert-dean/deadair/discussions/49).

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
