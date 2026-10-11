# @deadair/plugin-pandora

Pandora as a deadair music provider: search, your playlists, and, with **Pandora Premium**, its
records on air.

**Unofficial.** Pandora publishes no API. This plugin signs in the way Pandora's own Android app
does and then talks to the web app's API, which is what pianobar, pydora and pandora-tui have done
for years. Pandora can change any of it without notice, and doing this is not something its terms
contemplate. It works only from the US.

## What it needs

| To | You need |
| --- | --- |
| Search, describe a record, list and import playlists | Any Pandora account |
| Air a record the station chose | Pandora Premium |

A free or Plus account plays stations, which pick their own records, and Pandora refuses it a
chosen one (`NO_ENTITLEMENTS`). The plugin reports that refusal as one about the record, so the
station plays that record from another provider if it has one and holds nothing against the
plugin. **Test connection** says which kind of account it signed in to.

Pandora plays one stream per account. Measured 2026-10-11 on a free account, a phone playing
the same account did not stop the station's fetches, but the plugin is ready for Pandora saying
the account is playing elsewhere: that is reported as the account being busy, and the station
tries the record again a few minutes later instead of giving up on it.

## How it works

**Signing in** goes through the tuner API at `tuner.pandora.com`: a partner sign-in with the
Android app's published profile (`PARTNER` in `pandora.manifest.ts`), then yours, encrypted with
Blowfish. `pandora.blowfish.ts` is a small implementation of its own, because OpenSSL 3 keeps
`bf-ecb` behind its legacy provider. Its tables are computed from pi when it loads, and the
published test vectors pin every digit. The web API's own sign-in sits behind a browser bot check,
which is why the tuner is used for this step and nothing else.

**Everything else** is the web API at `www.pandora.com/api`, with the tuner's token as
`X-AuthToken` and a CSRF token sent as both a header and a cookie.

| Job | Endpoint |
| --- | --- |
| Search | `v3/sod/search`, tracks only |
| A record's details, ISRC included | `v4/catalog/annotateObjects` |
| Your playlists | `v6/collections/getSortedPlaylists` |
| A playlist's records | `v7/playlists/getTracks` |
| A chosen record's audio | `v1/playback/source`, from its album, starting at it |
| It went to air | `v1/station/trackStarted` with the token it was served under |
| It came off | `v1/event/ended` with the seconds heard |

**The audio** is a signed link on Pandora's CDN that needs no headers: AAC in an MP4 file, which
the station stores as `.m4a`. The station downloads it a few records ahead of air, as it does any
provider's.

**The reports** are what Pandora's own player sends. The station tells the plugin when one of its
records starts and ends (`reportPlayback`), and the plugin reports it against the place the record
was served from. Pandora accepted those reports even after the device had moved on to later
records, which it always has, since the station fetches ahead.

The search, annotation, playback and event answers in `tests/fixtures` were recorded from a live
account on 2026-10-11, with its ids and tokens replaced. The two playlist endpoints' shapes come
from pandora-tui's working client and have not been recorded yet.

## Setting it up

1. Enable **Pandora** under Plugins.
2. Enter the account's email and password. Pandora has no way to let an app in without them.
3. Press **Test connection**. It says whether the account is Premium.

## When it breaks

Every client of this API sends the same Android partner profile, so when Pandora rotates it, all of
them stop at once and Test connection says Pandora refused the partner sign-in. The unofficial API
documentation and pianobar's issue tracker are where a new profile turns up. Pandora refusing the
country means the station is not reaching it from the US.
