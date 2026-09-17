from cookies import looks_signed_in, parse_cookie_header, to_netscape


def test_parses_a_header_into_pairs():
    assert parse_cookie_header("SID=abc; HSID=def") == {"SID": "abc", "HSID": "def"}


def test_keeps_values_containing_equals():
    # Base64 values carry padding, and splitting on every `=` truncates them.
    assert parse_cookie_header("__Secure-3PSID=a=b==")["__Secure-3PSID"] == "a=b=="


def test_skips_fragments_with_no_equals():
    # A copy-paste can carry a stray word; inventing a value for it would put
    # nonsense in the jar under a plausible name.
    assert parse_cookie_header("SID=abc; garbage; HSID=def") == {"SID": "abc", "HSID": "def"}


def test_writes_a_netscape_jar():
    jar = to_netscape("SID=abc; HSID=def", now=0)
    lines = [line for line in jar.splitlines() if line and not line.startswith("#")]
    assert len(lines) == 2
    domain, subdomains, path, secure, expiry, name, value = lines[0].split("\t")
    assert (domain, subdomains, path, secure, name, value) == (".youtube.com", "TRUE", "/", "TRUE", "SID", "abc")
    assert int(expiry) > 0


def test_jar_is_tab_separated_not_space_separated():
    # A space-separated jar parses as one field and yt-dlp silently sends nothing.
    assert "\t" in to_netscape("SID=abc", now=0).splitlines()[-1]


def test_recognises_a_signed_in_header():
    assert looks_signed_in("SID=abc; HSID=def")
    assert looks_signed_in("__Secure-3PSID=abc")


def test_rejects_something_that_is_not_a_session():
    assert not looks_signed_in("")
    assert not looks_signed_in("VISITOR_INFO1_LIVE=abc; YSC=def")
    assert not looks_signed_in("https://music.youtube.com/playlist?list=PLabc")
