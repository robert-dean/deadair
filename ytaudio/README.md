# ytaudio

Turns a YouTube video id into a URL the station can fetch. It never downloads
audio and never proxies any.

This file is the contract. `app.py` is one implementation of it, and anything
answering these three endpoints is a valid resolver.

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
format. yt-dlp finds rungs it does not, and — this is the point — **keeps**
finding them, on somebody else's schedule rather than ours. The alternative was
implementing the segment protocol and its attestation here and owning every
break. See [discussion #49](https://github.com/robert-dean/deadair/discussions/49).

## A paid account is required

The same requirement the Spotify path has, for a different reason.

YouTube serves a **free** account the segment protocol and nothing else, so there
is no URL to hand back. Measured on a real free-tier account: signed out, a track
offers 39 formats; signed in, none at all. The resolver detects this exactly — no
formats *and* a session — and answers `402` naming it, rather than letting an
operator read yt-dlp's own words for it ("Requested format is not available") as
a bug in the station.

## Endpoints

| | |
| --- | --- |
| `GET /health` | `{ ok, hasSession }` |
| `POST /session` | `{ cookie }` — the operator's Cookie header. `400` if it carries no session at all |
| `DELETE /session` | forget it |
| `POST /resolve` | `{ videoId }` → `{ url, expiresAt, mimeType, itag, durationMs, filesize }` |

The session is **pushed**, not read from disk, so there is exactly one place an
operator pastes a cookie: the plugin's own settings card, where it is stored
encrypted. What this process keeps is a cache of it, on a file it owns, and it
dies with the process.

### What a failure means

| code | HTTP | The station should |
| --- | --- | --- |
| `unavailable` | 410 | write the copy off, never retry |
| `premium` | 402 | tell the operator; nothing else will change it |
| `auth` | 401 | the cookie is dead or missing |
| `refused` | 502 | the upstream would not serve this format; it is resting now |
| `cooling` | 503 | that format is resting; try again later |
| `upstream` | 502 | retry on the usual backoff |

## Four behaviours that are ours regardless of the library

Each is a bug the station would otherwise ship and diagnose from a listener's
ears, and writing them down here is what makes them survive yt-dlp being swapped
out for something else.

**Audio ONLY, never merely audio-bearing.** A rung that answers with one
pre-muxed 360p stream satisfies "has an audio track" while being a video download
at the wrong bitrate for a music station. The format selector says `vcodec=none`
and `_pick` re-checks it rather than trusting the string.

**Probe before serving.** One `bytes=0-0` range, content type checked, `text`,
`json` and `xml` refused. An upstream that answers a refusal with a 200 and a
JSON body is otherwise handed to the player as a record — and Liquidsoap picks
its decoder from the content type, so a wrong one fails as **silence**, which is
the worst failure shape available.

**Cool down per FORMAT, not per track.** A 403 on one itag is a statement about
that rendition. Resting the track instead is how a whole library goes unplayable
behind a single bad format.

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
