"""What `_download` will fetch, and which redirects it will follow.

Against real servers on loopback rather than a stubbed urllib, because the
thing under test is urllib's own redirect machinery with the guard inside it,
and a stub would only prove the stub calls the guard.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import app
from app import AnalysisError, _download, _is_private


def _server(routes: dict[str, tuple[int, dict[str, str], bytes]]) -> ThreadingHTTPServer:
    """A loopback server answering each path with `(status, headers, body)`."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            status, headers, body = routes.get(self.path, (404, {}, b""))
            self.send_response(status)
            for name, value in headers.items():
                self.send_header(name, value)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _base(server: ThreadingHTTPServer) -> str:
    return f"http://127.0.0.1:{server.server_address[1]}"


@pytest.fixture
def other() -> Iterator[ThreadingHTTPServer]:
    """A second origin on this machine: what a redirect to a private address reaches."""
    server = _server({"/audio": (200, {"content-type": "audio/flac"}, b"elsewhere")})
    yield server
    server.shutdown()


def _station(routes: dict[str, tuple[int, dict[str, str], bytes]]) -> Iterator[ThreadingHTTPServer]:
    server = _server(routes)
    yield server
    server.shutdown()


def _fetched(url: str) -> bytes:
    path, whole = _download(url)
    try:
        assert whole
        with open(path, "rb") as handle:
            return handle.read()
    finally:
        os.unlink(path)


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://127.0.0.1/audio", "data:audio/flac;base64,AAAA", "/srv/app.py", "http:///nohost"])
def test_refuses_anything_but_http_and_https_before_fetching(url: str) -> None:
    with pytest.raises(AnalysisError) as raised:
        _download(url)
    assert raised.value.code == "unfetchable"
    assert raised.value.status == 400


def test_fetches_the_station_url_it_was_given_although_it_is_private() -> None:
    # The station's own routes live on a private address, and `/join` needs them.
    for station in _station({"/segment": (200, {}, b"segment")}):
        assert _fetched(f"{_base(station)}/segment") == b"segment"


def test_follows_a_redirect_back_to_the_origin_it_was_asked_for() -> None:
    for station in _station({"/a": (302, {"location": "/b"}, b""), "/b": (200, {}, b"same origin")}):
        assert _fetched(f"{_base(station)}/a") == b"same origin"


def test_refuses_a_redirect_to_another_private_origin(other: ThreadingHTTPServer) -> None:
    for station in _station({"/a": (302, {"location": f"{_base(other)}/audio"}, b"")}):
        with pytest.raises(AnalysisError) as raised:
            _download(f"{_base(station)}/a")
    assert raised.value.code == "unfetchable"
    assert "private address" in raised.value.message
    assert raised.value.status == 502


def test_refuses_a_redirect_two_hops_in(other: ThreadingHTTPServer) -> None:
    # The first hop stays on the station's origin and is allowed; the second leaves it.
    routes = {"/a": (302, {"location": "/b"}, b""), "/b": (307, {"location": f"{_base(other)}/audio"}, b"")}
    for station in _station(routes):
        with pytest.raises(AnalysisError, match="private address"):
            _download(f"{_base(station)}/a")


def test_follows_a_redirect_to_an_allowed_origin(monkeypatch: pytest.MonkeyPatch, other: ThreadingHTTPServer) -> None:
    monkeypatch.setattr(app, "ALLOWED_ORIGINS", frozenset({_base(other)}))
    for station in _station({"/a": (302, {"location": f"{_base(other)}/audio"}, b"")}):
        assert _fetched(f"{_base(station)}/a") == b"elsewhere"


def test_follows_a_redirect_to_a_public_address(monkeypatch: pytest.MonkeyPatch, other: ThreadingHTTPServer) -> None:
    # A provider's CDN. Loopback stands in for it, so the resolution is what is faked.
    monkeypatch.setattr(app, "_is_private", lambda host: False)
    for station in _station({"/a": (302, {"location": f"{_base(other)}/audio"}, b"")}):
        assert _fetched(f"{_base(station)}/a") == b"elsewhere"


def test_refuses_a_redirect_to_a_file_url() -> None:
    for station in _station({"/a": (302, {"location": "file:///etc/passwd"}, b"")}):
        with pytest.raises(AnalysisError) as raised:
            _download(f"{_base(station)}/a")
    assert raised.value.code == "unfetchable"


@pytest.mark.parametrize("host", ["127.0.0.1", "10.0.0.7", "192.168.1.20", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"])
def test_counts_this_machine_and_its_network_as_private(host: str) -> None:
    assert _is_private(host)


@pytest.mark.parametrize("host", ["8.8.8.8", "2606:4700:4700::1111"])
def test_counts_a_public_address_as_public(host: str) -> None:
    assert not _is_private(host)


def test_counts_a_name_that_does_not_resolve_as_public() -> None:
    # Not private, so the fetch goes ahead and fails on the name in the ordinary way.
    assert not _is_private("no-such-host.invalid")
