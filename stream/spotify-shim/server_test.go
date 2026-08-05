package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Routing, and specifically which requests are allowed to reach Spotify.
//
// The server under test carries a NIL session holder on purpose: anything that tries to open a
// track panics, so "did this request touch Spotify?" becomes something the test can actually
// assert rather than infer.

func headOnlyServer() *server {
	return &server{log: &librespot.NullLogger{}, secret: secret, sessions: nil}
}

func signedHead(t *testing.T, id string) *http.Request {
	t.Helper()
	token := signToken(secret, id, time.Now().Add(time.Hour))
	return httptest.NewRequest("HEAD", "/track/"+id+"?t="+token, nil)
}

// Liquidsoap sniffs each queued item with a HEAD before downloading it. Answering that with the
// full pipeline cost a second metadata lookup, a second audio key and the first CDN chunk per
// track, because Go's router matches HEAD against a "GET" pattern.
func TestHeadIsAnsweredWithoutFetchingTheTrack(t *testing.T) {
	rec := httptest.NewRecorder()
	// Panics if the handler reaches for a session, which is the whole point.
	headOnlyServer().routes().ServeHTTP(rec, signedHead(t, "4PTG3Z6ehGkBFwjybzWkR8"))

	res := rec.Result()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("HEAD answered %d, want 200", res.StatusCode)
	}
	if got := res.Header.Get("Content-Type"); got != "audio/ogg" {
		t.Fatalf("content-type %q, want audio/ogg", got)
	}
	if got := res.Header.Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("accept-ranges %q, want bytes: the GET honours Range, so a HEAD must say so", got)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("HEAD returned a %d byte body", rec.Body.Len())
	}
}

// A HEAD confirms a track exists and is fetchable, so it stays behind the same signature the GET
// requires.
func TestHeadStillRequiresAValidToken(t *testing.T) {
	for name, target := range map[string]string{
		"no token":      "/track/abc",
		"bad signature": "/track/abc?t=99999999999.AAAA",
		"other track":   "/track/abc?t=" + signToken(secret, "different", time.Now().Add(time.Hour)),
	} {
		rec := httptest.NewRecorder()
		headOnlyServer().routes().ServeHTTP(rec, httptest.NewRequest("HEAD", target, nil))
		if rec.Result().StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s: answered %d, want 401", name, rec.Result().StatusCode)
		}
	}
}

// The health probe reports whether a login is established; it must never establish one, or every
// container restart would hit Spotify whether or not the station is even in Spotify mode.
func TestHealthReportsTheSessionWithoutOpeningOne(t *testing.T) {
	srv := &server{log: &librespot.NullLogger{}, secret: secret, sessions: newSessionHolder(staticCredentials{}, &librespot.NullLogger{}, nil)}
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/health", nil))

	if rec.Result().StatusCode != http.StatusOK {
		t.Fatalf("health answered %d, want 200", rec.Result().StatusCode)
	}
	if body := rec.Body.String(); body != `{"ok":true,"session":false}`+"\n" {
		t.Fatalf("health said %q", body)
	}
}
