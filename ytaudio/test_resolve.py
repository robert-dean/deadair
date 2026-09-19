import urllib.error

import pytest

from resolve import COOLDOWN_S, FORMAT, STORABLE_TYPES, ResolveError, Unavailable, _pick, _total_of, cooldowns, expiry_of, probe, whole_range


class _Response:
    def __init__(self, content_type, status=206, content_range=None):
        self.headers = {"content-type": content_type}
        if content_range:
            self.headers["content-range"] = content_range
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _opener(content_type, status=206, content_range=None):
    return lambda _request, timeout=None: _Response(content_type, status, content_range)


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
    def test_accepts_audio_the_station_stores(self):
        assert probe("https://x/y", opener=_opener("audio/mp4")).content_type == "audio/mp4"

    def test_reads_the_whole_size_off_the_one_byte_it_asked_for(self):
        probed = probe("https://x/y", opener=_opener("audio/mp4", content_range="bytes 0-0/7552326"))
        assert probed.total_bytes == 7552326

    def test_reports_no_size_rather_than_guessing_one(self):
        assert probe("https://x/y", opener=_opener("audio/mp4")).total_bytes is None

    def test_refuses_webm_because_the_station_will_not_keep_it(self):
        # The bug this guards: a WebM resolve fetched perfectly and was then refused
        # by the track store at download, four times, and benched -- every record.
        with pytest.raises(ResolveError) as raised:
            probe("https://x/y", opener=_opener("audio/webm"))
        assert raised.value.code == "refused"
        assert "does not store" in raised.value.message

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


class TestHowAFailureReads:
    """yt-dlp answers every failure as prose; these are the words that decide what the station does."""

    @staticmethod
    def _failing_with(message):
        import resolve as module

        class _Boom(module.yt_dlp.utils.DownloadError):
            def __init__(self):
                super().__init__(message)

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
                module.resolve("x")
            return raised.value
        finally:
            module.yt_dlp.YoutubeDL = original

    @pytest.mark.parametrize(
        "message",
        [
            "ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.",
            "ERROR: [youtube] x: Join this channel to get access to members-only content like this video",
            "ERROR: [youtube] x: This video is only available to Music Premium members",
        ],
    )
    def test_a_record_only_an_account_may_play_is_named(self, message):
        assert self._failing_with(message).code == "needs-account"

    def test_the_bot_check_is_not_blamed_on_the_record(self):
        # It says "sign in" too, but it is about this address. Written off as a
        # per-record refusal, it would quietly strike every record it touched.
        failure = self._failing_with("ERROR: [youtube] x: Sign in to confirm you're not a bot. Use --cookies-from-browser")
        assert failure.code == "upstream"

    def test_a_page_error_is_not_mistaken_for_an_age_gate(self):
        # "page" contains "age", which is what a bare substring match once caught.
        assert self._failing_with("ERROR: [youtube] x: Unable to download webpage: HTTP Error 500").code == "upstream"

    def test_a_removed_record_is_unavailable(self):
        assert self._failing_with("ERROR: [youtube] x: Video unavailable. This video has been removed").code == "unavailable"


class TestTheStoreContract:
    """The resolver may only answer with what the station's track store keeps.

    `STORABLE_TYPES` mirrors `TRACK_SOURCE_TYPES` in
    apps/api/src/modules/playout/audio/track.store.ts by hand, across a language
    boundary. This reads that file, so the mirror cannot drift without a red test.
    """

    def _store_types(self):
        import pathlib
        import re

        store = pathlib.Path(__file__).resolve().parent.parent / "apps/api/src/modules/playout/audio/track.store.ts"
        text = store.read_text()
        block = text[text.index("TRACK_SOURCE_TYPES"):]
        block = block[: block.index("};")]
        return set(re.findall(r"'([a-z]+/[a-z0-9.+-]+)'\s*:", block))

    def test_the_mirror_matches_the_store(self):
        assert set(STORABLE_TYPES) == self._store_types()

    def test_webm_is_not_storable(self):
        assert "audio/webm" not in STORABLE_TYPES

    def test_the_format_asks_for_a_storable_container(self):
        assert "ext=m4a" in FORMAT and "vcodec=none" in FORMAT



class TestWholeRange:
    """The fix for a 7.5 MB record arriving at 32 KB/s and timing out at the station.

    googlevideo throttles a GET with no range and serves a ranged one at full speed.
    The station fetches with one plain GET, so the range rides in the URL instead.
    """

    def test_asks_for_the_whole_file_as_a_range(self):
        assert whole_range("https://h/videoplayback?itag=140&sig=AB%3D", 7552326) == "https://h/videoplayback?itag=140&sig=AB%3D&range=0-7552325"

    def test_leaves_the_signed_query_byte_for_byte(self):
        # Re-encoding a signed query is how the signature breaks, so nothing before the range moves.
        url = "https://h/videoplayback?expire=1&sig=A%2FB%3D%3D&lsig=x%3D"
        assert whole_range(url, 10).startswith(url)

    def test_replaces_a_range_rather_than_adding_a_second(self):
        assert whole_range("https://h/v?range=0-9&itag=140", 100) == "https://h/v?range=0-99&itag=140"

    def test_works_on_a_url_with_no_query(self):
        assert whole_range("https://h/v", 1) == "https://h/v?range=0-0"

    def test_parses_only_a_usable_total(self):
        assert _total_of("bytes 0-0/7552326") == 7552326
        assert _total_of("bytes 0-0/*") is None
        assert _total_of(None) is None
        assert _total_of("garbage") is None
