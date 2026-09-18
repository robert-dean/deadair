import urllib.error

import pytest

from resolve import COOLDOWN_S, ResolveError, Unavailable, _pick, cooldowns, expiry_of, probe


class _Response:
    def __init__(self, content_type, status=206):
        self.headers = {"content-type": content_type}
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _opener(content_type, status=206):
    return lambda _request, timeout=None: _Response(content_type, status)


@pytest.fixture(autouse=True)
def _clear_cooldowns():
    cooldowns.clear()
    yield
    cooldowns.clear()


class TestExpiry:
    def test_honours_the_urls_own_expire(self):
        # A URL that outlives its upstream is an item that fails at the moment it
        # airs, which is the one time nothing can be done about it.
        assert expiry_of("https://x/y?expire=1789703389&other=1") == 1789703389000

    def test_falls_back_when_the_url_states_none(self):
        # Absent must not read as "never expires" and pin a dead URL on a row.
        assert expiry_of("https://x/y", now=0) == 30 * 60 * 1000

    def test_falls_back_when_the_expire_is_not_a_number(self):
        assert expiry_of("https://x/y?expire=soon", now=0) == 30 * 60 * 1000


class TestProbe:
    def test_accepts_audio(self):
        assert probe("https://x/y", opener=_opener("audio/webm")) == "audio/webm"

    def test_refuses_json_served_as_200(self):
        # The failure this exists for: an upstream refusing with a 200 and a JSON
        # body is handed to the player as a record, and Liquidsoap picks its
        # decoder from the content type -- so a wrong one fails as SILENCE.
        with pytest.raises(ResolveError) as raised:
            probe("https://x/y", opener=_opener("application/json", status=200))
        assert raised.value.code == "refused"

    def test_refuses_html(self):
        with pytest.raises(ResolveError) as raised:
            probe("https://x/y", opener=_opener("text/html", status=200))
        assert raised.value.code == "refused"

    def test_refuses_video_even_though_it_is_media(self):
        with pytest.raises(ResolveError) as raised:
            probe("https://x/y", opener=_opener("video/mp4"))
        assert raised.value.code == "refused"

    def test_refuses_an_upstream_that_says_nothing(self):
        with pytest.raises(ResolveError):
            probe("https://x/y", opener=_opener(""))

    def test_treats_403_as_a_refusal_rather_than_a_transport_fault(self):
        def opener(_request, timeout=None):
            raise urllib.error.HTTPError("https://x/y", 403, "Forbidden", {}, None)

        with pytest.raises(ResolveError) as raised:
            probe("https://x/y", opener=opener)
        assert raised.value.code == "refused"


class TestPick:
    def test_takes_an_audio_only_format(self):
        chosen = _pick({"requested_downloads": [{"url": "https://x", "vcodec": "none", "acodec": "opus"}]})
        assert chosen["acodec"] == "opus"

    def test_refuses_a_premuxed_stream_that_merely_carries_audio(self):
        # The live failure mode: a rung answers with one pre-muxed 360p stream,
        # which passes "has an audio track" while being a video download at the
        # wrong bitrate for a music station.
        with pytest.raises(Unavailable):
            _pick({"requested_downloads": [{"url": "https://x", "vcodec": "avc1", "acodec": "mp4a"}]})

    def test_refuses_a_format_with_no_audio(self):
        with pytest.raises(Unavailable):
            _pick({"requested_downloads": [{"url": "https://x", "vcodec": "none", "acodec": "none"}]})

    def test_refuses_a_format_with_no_url(self):
        with pytest.raises(Unavailable):
            _pick({"requested_downloads": [{"vcodec": "none", "acodec": "opus"}]})


class TestCooldowns:
    def test_a_refused_format_rests(self):
        cooldowns.penalise("251", now=0)
        assert cooldowns.resting("251", now=1)

    def test_it_is_per_format_not_per_track(self):
        # A 403 on one itag is a statement about that rendition. Resting the whole
        # track instead is how a library goes unplayable behind a single format.
        cooldowns.penalise("251", now=0)
        assert not cooldowns.resting("140", now=1)

    def test_it_expires(self):
        cooldowns.penalise("251", now=0)
        assert not cooldowns.resting("251", now=COOLDOWN_S + 1)


class TestSignedInNoFormats:
    def test_signed_in_with_no_formats_is_named_rather_than_left_as_upstream(self):
        # yt-dlp's own words for it ("Requested format is not available") read as a
        # bug in our selector.
        import resolve as module

        class _Boom(module.yt_dlp.utils.DownloadError):
            def __init__(self):
                super().__init__("ERROR: [youtube] x: Requested format is not available. Use --list-formats")

        class _FakeYDL:
            def __init__(self, *_args, **_kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def extract_info(self, *_args, **_kwargs):
                raise _Boom()

        original = module.yt_dlp.YoutubeDL
        module.yt_dlp.YoutubeDL = _FakeYDL
        try:
            with pytest.raises(module.SignedInNoFormats) as raised:
                module.resolve("x", cookiefile="/tmp/jar")
            assert raised.value.code == "sabr"
            # The message must NOT claim the account is unpaid: the yt-dlp tracker
            # says Premium sessions land here too, and this check never tested that.
            assert "not a Music Premium subscriber" not in raised.value.message
            assert "not evidence about this account's subscription" in raised.value.message
        finally:
            module.yt_dlp.YoutubeDL = original

    def test_the_same_message_signed_OUT_is_not_blamed_on_the_session(self):
        # Without a session the same words mean something else entirely.
        import resolve as module

        class _Boom(module.yt_dlp.utils.DownloadError):
            def __init__(self):
                super().__init__("ERROR: [youtube] x: Requested format is not available.")

        class _FakeYDL:
            def __init__(self, *_args, **_kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def extract_info(self, *_args, **_kwargs):
                raise _Boom()

        original = module.yt_dlp.YoutubeDL
        module.yt_dlp.YoutubeDL = _FakeYDL
        try:
            with pytest.raises(module.ResolveError) as raised:
                module.resolve("x", cookiefile=None)
            assert raised.value.code != "sabr"
        finally:
            module.yt_dlp.YoutubeDL = original
