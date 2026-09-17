"""Turning a YouTube id into a URL the station can fetch.

This module answers ONE question -- where are this record's bytes -- and answers
it with a plain HTTPS URL. It never downloads audio and never proxies any: the
station fetches the URL itself, caches it and serves it to the player, exactly
as it does for every other provider. `app.py` is the HTTP surface; everything
here is testable without one.

**Why this is a separate process at all.** The thing that knows how to resolve a
YouTube audio URL is yt-dlp, which is Python, and the plugin is Node running
in-process inside the API. That is the whole reason, and it is the same reason
`analysis/` is a separate process. No audio passes through here.

**Why not do it in the plugin with an InnerTube client.** Measured 2026-09-17:
every client identity `youtubei.js` offers answered SABR, with no plain URL on
any format, for a signed-in session. yt-dlp finds rungs it does not, and keeps
finding them, which is the entire value of depending on it rather than on a
protocol implementation of our own. See discussion #49.
"""

from __future__ import annotations

import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

import yt_dlp

#: Audio ONLY, never merely audio-bearing. A rung that answers with one pre-muxed
#: 360p stream satisfies "has an audio track" while being a video download at the
#: wrong bitrate for a music station, and it passes every check that asks whether
#: the content type begins with `audio/`.
FORMAT = "bestaudio[vcodec=none]"

#: How long a format that refused us is left alone. Per FORMAT rather than per
#: track: a 403 on one itag is a statement about that rendition, and retrying the
#: same one is how a whole library goes unplayable behind a single bad format.
COOLDOWN_S = 10 * 60

#: Bounds the probe. It is one byte over a connection that is either there or not.
PROBE_TIMEOUT_S = 10

#: A URL with no `expire` of its own is treated as good for this long. YouTube
#: always sends one today; this is what stops an absent parameter reading as
#: "never expires" and pinning a dead URL on a row forever.
DEFAULT_TTL_S = 30 * 60

#: Content types that mean the upstream answered with a refusal rather than audio.
#: A JSON error body served as 200 is otherwise handed to the player as a record,
#: and Liquidsoap picks its decoder from the content type, so a wrong one fails as
#: SILENCE rather than as an error. That is the worst failure shape available.
_REFUSAL_TYPES = ("text/", "application/json", "application/xml", "text/xml")


class ResolveError(Exception):
    """A failure with a code the caller can act on rather than only report."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Unavailable(ResolveError):
    """The upstream has no audio for this id and no alternative. Do not retry."""

    def __init__(self, message: str) -> None:
        super().__init__("unavailable", message)


class NotPremium(ResolveError):
    """The account is signed in and is not a paying one.

    Worth its own class because of how it presents. YouTube Music serves a free
    account the adaptive segment protocol and nothing else, so yt-dlp finds no
    format it can take and says "Requested format is not available" -- which
    reads as a bug in our format selector, names nothing an operator can act on,
    and is indistinguishable from a genuinely format-less record.

    Measured 2026-09-17 on a real free-tier account: signed out, the same track
    offers 39 formats; signed in, none. The signal is precise -- no formats AND a
    session -- so it is worth saying plainly rather than leaving as `upstream`,
    which would also have the station retry it forever.
    """

    def __init__(self) -> None:
        super().__init__(
            "premium",
            "this YouTube account is signed in but is not a Music Premium subscriber, and YouTube serves "
            "free accounts a streaming protocol this station cannot fetch. A paid account is required, the "
            "same way the Spotify path requires one.",
        )


@dataclass(frozen=True)
class Resolved:
    """Where a record's bytes are, and until when."""

    url: str
    expires_at_ms: int
    mime_type: str
    itag: str
    duration_ms: int | None
    filesize: int | None


class _Cooldowns:
    """Formats that refused us recently, and when to try them again."""

    def __init__(self) -> None:
        self._until: dict[str, float] = {}

    def penalise(self, itag: str, *, now: float | None = None) -> None:
        self._until[itag] = (now if now is not None else time.time()) + COOLDOWN_S

    def resting(self, itag: str, *, now: float | None = None) -> bool:
        until = self._until.get(itag)
        if until is None:
            return False
        if (now if now is not None else time.time()) >= until:
            del self._until[itag]
            return False
        return True

    def clear(self) -> None:
        self._until.clear()


cooldowns = _Cooldowns()


def expiry_of(url: str, *, now: float | None = None) -> int:
    """The URL's OWN expiry, in unix epoch milliseconds.

    Honoured rather than replaced with a TTL of our own, because a URL that
    outlives its upstream is an item that fails at the moment it airs -- the one
    time nothing can be done about it. The station stores this on the binding and
    re-resolves when it passes.
    """
    seconds = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("expire")
    if seconds:
        try:
            return int(seconds[0]) * 1000
        except ValueError:
            pass
    return int(((now if now is not None else time.time()) + DEFAULT_TTL_S) * 1000)


def probe(url: str, *, opener=urllib.request.urlopen) -> str:
    """One byte, to find out whether this is audio before anything plays it.

    Returns the content type. Raises {@link ResolveError} when the upstream
    answers something that is not media, which is the case this exists for: an
    upstream that refuses with a 200 and a JSON body is otherwise indistinguishable
    from a track, right up until the station airs silence.
    """
    request = urllib.request.Request(url, headers={"Range": "bytes=0-0"}, method="GET")
    try:
        with opener(request, timeout=PROBE_TIMEOUT_S) as response:
            content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
            status = getattr(response, "status", 200)
    except urllib.error.HTTPError as error:
        if error.code in (403, 410):
            raise ResolveError("refused", f"the upstream refused the url with {error.code}") from error
        raise ResolveError("upstream", f"probing the url answered {error.code}") from error
    except Exception as error:  # noqa: BLE001 - any transport failure is the same answer here
        raise ResolveError("upstream", f"could not probe the url: {error}") from error

    if status not in (200, 206):
        raise ResolveError("upstream", f"probing the url answered {status}")
    if not content_type:
        raise ResolveError("upstream", "the upstream did not say what it was serving")
    if content_type.startswith(_REFUSAL_TYPES):
        raise ResolveError("refused", f"the upstream answered {content_type} rather than audio")
    if not content_type.startswith("audio/"):
        raise ResolveError("refused", f"the upstream answered {content_type}, which is not audio")
    return content_type


def _pick(info: dict) -> dict:
    """The chosen format, refusing anything carrying video.

    yt-dlp has already applied {@link FORMAT}. This re-checks rather than trusting
    it, because the selector is a string and a future version could interpret it
    differently -- and the thing being guarded against is subtle enough to ship
    unnoticed. `vcodec` of `none` is the positive statement that there is no video.
    """
    chosen = info.get("requested_downloads") or []
    formats = chosen or [info]
    for candidate in formats:
        if not candidate.get("url"):
            continue
        if candidate.get("vcodec") not in (None, "none"):
            continue
        if candidate.get("acodec") in (None, "none"):
            continue
        return candidate
    raise Unavailable("no audio-only format was offered for this record")


def resolve(video_id: str, *, cookiefile: str | None = None, now: float | None = None) -> Resolved:
    """Where this record's audio is, or why it is not available.

    `cookiefile` is the operator's own session. It is required in practice: a
    signed-out resolve works for some records and not for the ones an account
    pays for, which is the same shape of requirement the Spotify path has.
    """
    options = {
        "format": FORMAT,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        # Nothing is written to disk by this process, ever.
        "simulate": True,
        "skip_download": True,
        "extract_flat": False,
    }
    if cookiefile:
        options["cookiefile"] = cookiefile

    url = f"https://music.youtube.com/watch?v={video_id}"
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as error:
        text = str(error)
        lowered = text.lower()
        # Checked BEFORE "unavailable", which this message also contains as a
        # suggestion ("Use --list-formats"). Ordered the other way, every free
        # account reads as a missing record.
        if "requested format is not available" in lowered and cookiefile:
            raise NotPremium() from error
        if "private" in lowered or "unavailable" in lowered or "removed" in lowered:
            raise Unavailable(text) from error
        if "sign in" in lowered or "cookies" in lowered or "age" in lowered:
            raise ResolveError("auth", text) from error
        raise ResolveError("upstream", text) from error
    except Exception as error:  # noqa: BLE001
        raise ResolveError("upstream", str(error)) from error

    if not info:
        raise Unavailable("the upstream returned nothing for this id")

    chosen = _pick(info)
    itag = str(chosen.get("format_id") or "unknown")
    if cooldowns.resting(itag, now=now):
        raise ResolveError("cooling", f"format {itag} refused us recently and is resting")

    media_url = chosen["url"]
    try:
        content_type = probe(media_url)
    except ResolveError as error:
        if error.code == "refused":
            cooldowns.penalise(itag, now=now)
        raise

    duration = info.get("duration")
    return Resolved(
        url=media_url,
        expires_at_ms=expiry_of(media_url, now=now),
        mime_type=content_type,
        itag=itag,
        duration_ms=int(duration * 1000) if isinstance(duration, (int, float)) else None,
        filesize=chosen.get("filesize") or chosen.get("filesize_approx"),
    )
