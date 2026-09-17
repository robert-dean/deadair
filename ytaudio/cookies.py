"""Turning a pasted Cookie header into the jar yt-dlp wants.

The operator copies a `Cookie:` request header out of a browser, which is what
every guide for this tells them to do and what the plugin's own settings field
asks for. yt-dlp reads a Netscape cookie file. This is the whole of the
difference, kept in its own module because it is pure text handling and worth
testing without a network or a subprocess anywhere near it.
"""

from __future__ import annotations

import time

# Far enough out that a jar written now does not expire mid-session, and finite
# because a cookie file with no expiry at all is one some parsers reject.
_EXPIRY_S = 365 * 24 * 60 * 60

_HEADER = "# Netscape HTTP Cookie File"

# Cookies are sent to both hosts: youtubei lives on www.youtube.com and the
# operator may well have copied the header from music.youtube.com.
_DOMAIN = ".youtube.com"


def parse_cookie_header(header: str) -> dict[str, str]:
    """The `name=value` pairs out of a Cookie header, in the order they appeared.

    Anything without an `=` is skipped rather than guessed at: a header that has
    been through a copy-paste can carry a stray word, and inventing a value for
    it would put nonsense in the jar under a plausible name.
    """
    pairs: dict[str, str] = {}
    for part in header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        if name:
            pairs[name] = value.strip()
    return pairs


def to_netscape(header: str, *, now: float | None = None) -> str:
    """A Netscape cookie jar holding everything the header carried.

    Every cookie is written against `.youtube.com` with the secure flag set. The
    real jar a browser holds is more precise than that -- per-host, per-path,
    some of it host-only -- and the precision is not recoverable from a header,
    which is a flat list of names and values with none of that attached. Writing
    them all at the widest scope the account uses is the honest reconstruction:
    it sends the same cookies the browser would have sent to the same origin,
    which is exactly what the header was a record of.
    """
    stamp = int((now if now is not None else time.time()) + _EXPIRY_S)
    lines = [_HEADER, ""]
    for name, value in parse_cookie_header(header).items():
        # domain, include-subdomains, path, secure, expiry, name, value
        lines.append("\t".join([_DOMAIN, "TRUE", "/", "TRUE", str(stamp), name, value]))
    return "\n".join(lines) + "\n"


def looks_signed_in(header: str) -> bool:
    """Whether the header carries a session at all.

    A weak check on purpose, and it is NOT the credential test -- the plugin
    proves the cookie by using it, because a cookie can be perfectly well-formed
    and dead. This exists so an operator who pastes the wrong thing entirely (a
    URL, a different header, an anonymous cookie) is told that rather than
    watching every track fail to resolve.
    """
    names = parse_cookie_header(header).keys()
    return "SID" in names or "__Secure-3PSID" in names
