# ytaudio

Turns a YouTube video id into a URL the station can fetch. It never downloads
audio and never proxies any.

This file is the contract. `app.py` is one implementation of it, and anything
answering these two endpoints is a valid resolver.

## Why this is a separate process

The thing that knows how to resolve a YouTube audio URL is **yt-dlp**, which is
Python. The plugin that needs the answer is Node, running in-process inside the
API. That is the whole reason, and it is the same one `analysis/` exists for.

**No audio passes through here.** The station fetches the URL itself,
caches the bytes and serves them to the player, exactly as it does for Navidrome.
So the rule that no decoding happens in Node is untouched, and so is the rule that
the app is the only thing that ever fetches a provider.

## Why not resolve in the plugin

Measured 2026-09-17 against a live account: every client identity `youtubei.js`
offers answered with YouTube's adaptive segment protocol and no plain URL on any
format. yt-dlp finds rungs it does not, and, which is the point, **keeps**
finding them, on somebody else's schedule rather than ours. The alternative was
implementing the segment protocol and its attestation here and owning every
break. See [discussion #49](https://github.com/robert-dean/deadair/discussions/49).

## Every resolve is signed out

This process holds **no credential**. The operator's cookie stays in the plugin,
which needs it for search, the library and playlists, and never crosses to here.

That is a measurement rather than a preference. Measured 2026-09-19 on the
operator's own account, through yt-dlp:

| Resolve | Formats offered | Fetchable |
| --- | --- | --- |
| signed out | 5 | yes, and it aired |
| signed in, no JS runtime | 0 | no |
| signed in, with Deno | 4 | no, every one answered 403 for want of a proof-of-origin token |

YouTube currently forces its segment streaming protocol on signed-in sessions,
and the yt-dlp tracker reports the same for Music Premium accounts
([#14390](https://github.com/yt-dlp/yt-dlp/issues/14390)). A session made
resolving strictly worse, and it cost a live Google credential sitting in a
second process to do it. This is also the goal #49 set for the audio half: the
credential never leaves the plugin.

**The price:** a record that only an account may play (age-gated, members-only,
Premium-only) answers `needs-account` and does not play from here. It is also
the path YouTube is most motivated to close, so a signed-out resolve that stops
working is the first thing to check when every record fails.

## Endpoints

| | |
| --- | --- |
| `GET /health` | `{ ok }` |
| `POST /resolve` | `{ videoId }` → `{ url, expiresAt, mimeType, itag, durationMs, filesize }` |

### What a failure means

| code | HTTP | The station should |
| --- | --- | --- |
| `unavailable` | 410 | write the copy off, never retry |
| `needs-account` | 403 | only an account may play this record, and a resolve never has one; skip it |
| `refused` | 502 | the upstream would not serve this format; it is resting now |
| `cooling` | 503 | that format is resting; try again later |
| `upstream` | 502 | retry on the usual backoff |

## Six behaviours that are ours regardless of the library

Each is a bug the station would otherwise ship and diagnose from a listener's
ears, and writing them down here is what makes them survive yt-dlp being swapped
out for something else.

**Audio ONLY, never merely audio-bearing.** A rung that answers with one
pre-muxed 360p stream satisfies "has an audio track" while being a video download
at the wrong bitrate for a music station. The format selector says `vcodec=none`
and `_pick` re-checks it rather than trusting the string.

**Only a container the station keeps.** The format asks for m4a, and the probe
refuses any type the station's track store does not accept. Plain `bestaudio` is
Opus in WebM, and the store refuses `audio/webm`: a resolve that fetched perfectly
was then refused at download, four times, and benched, for every record. The
accepted list is mirrored here by hand across a language boundary, and a test
reads `track.store.ts` so the mirror cannot drift.

**Probe before serving.** One `bytes=0-0` range, content type checked, `text`,
`json` and `xml` refused. An upstream that answers a refusal with a 200 and a
JSON body is otherwise handed to the player as a record, and Liquidsoap picks
its decoder from the content type, so a wrong one fails as **silence**, which is
the worst failure shape available.

**Cool down per FORMAT, not per track.** A 403 on one itag is a statement about
that rendition. Resting the track instead is how a whole library goes unplayable
behind a single bad format.

**Hold no credential.** See above. A resolver that stores a cookie is a second
place a live Google session can leak from, and it bought nothing.

**Honour the URL's own expiry.** The `expire` parameter is authoritative and is
what `expiresAt` reports. A URL that outlives its upstream is an item that fails
at the moment it airs, which is the one time nothing can be done about it.

## Licensing

yt-dlp's **source** is public domain under the Unlicense, which is what PyPI
ships and what `requirements.txt` installs. Its **release binaries** are GPLv3+,
because they bundle other things. This service depends on the source.

The station is a wrapper around it either way, and that is written down for
whoever runs this in [`docs/licensing.md`](../docs/licensing.md) rather than only
here.

## Running it

```bash
python -m venv venv && venv/bin/pip install -r requirements.txt
venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 9322
venv/bin/python -m pytest
```
