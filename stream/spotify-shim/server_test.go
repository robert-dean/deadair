package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
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

// ── POST /session ────────────────────────────────────────────────────────────

const shimSecret = "shim-secret"

// Refuses every request, so the background warm-connect a push kicks off fails at its first round
// trip instead of reaching Spotify from a test.
type offlineTransport struct{}

func (offlineTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("no network in tests")
}

// A server whose session holder is real (so a push can reset it and warm it) but which cannot reach
// anything. The assertions here are about what the route recorded, not about logging in.
func pushableServer() (*server, *pushedCredentials) {
	pushed := &pushedCredentials{fallback: staticCredentials{}}
	log := &librespot.NullLogger{}
	return &server{
		log:          log,
		secret:       secret,
		shimSecret:   shimSecret,
		pushed:       pushed,
		sessions:     newSessionHolder(pushed, log, &http.Client{Transport: offlineTransport{}}),
		fetchTimeout: time.Second,
	}, pushed
}

func pushRequest(body string, secretHeader string) *http.Request {
	req := httptest.NewRequest("POST", "/session", strings.NewReader(body))
	req.Header.Set("X-Spotify-Login-Secret", secretHeader)
	return req
}

// The login the app pushes is what the next fetch logs in with. Answered 202 rather than 200: the
// caller is inside a plugin invocation deadline, so the login itself happens after the response.
func TestSessionPushIsWhatTheNextFetchUses(t *testing.T) {
	srv, pushed := pushableServer()
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, pushRequest(`{"username":"station","accessToken":"tok","expiresAt":`+
		strconv.FormatInt(time.Now().Add(time.Hour).UnixMilli(), 10)+`}`, shimSecret))

	if rec.Result().StatusCode != http.StatusAccepted {
		t.Fatalf("push answered %d, want 202", rec.Result().StatusCode)
	}
	creds, err := pushed.fetch(context.Background(), nil)
	if err != nil {
		t.Fatalf("fetch after a push failed: %v", err)
	}
	if creds.username != "station" || creds.token != "tok" {
		t.Fatalf("fetch returned %q/%q, want station/tok", creds.username, creds.token)
	}
}

// This route decides whose account the shim fetches as, so an unauthenticated caller must not be
// able to point it at their own.
func TestSessionPushRequiresTheSecret(t *testing.T) {
	srv, pushed := pushableServer()
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, pushRequest(`{"username":"intruder","accessToken":"tok"}`, "wrong"))

	if rec.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("push with a bad secret answered %d, want 401", rec.Result().StatusCode)
	}
	if _, err := pushed.fetch(context.Background(), nil); err == nil {
		t.Fatal("a rejected push was stored anyway")
	}
}

// Not seeded is not the same as not matching: until the app has a secret, nothing could match, and
// answering 401 would send an operator looking for a mismatch that does not exist.
func TestSessionPushIsDisabledWithoutASecret(t *testing.T) {
	srv, _ := pushableServer()
	srv.shimSecret = ""
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, pushRequest(`{"username":"station","accessToken":"tok"}`, ""))

	if rec.Result().StatusCode != http.StatusNotFound {
		t.Fatalf("push with no secret configured answered %d, want 404", rec.Result().StatusCode)
	}
}

// A half-formed push must be refused rather than stored: credentials that are accepted and then
// fail at login turn a bad request into dead air one track later.
func TestSessionPushRejectsAnUnusableBody(t *testing.T) {
	for name, body := range map[string]string{
		"not json":     `{`,
		"no username":  `{"accessToken":"tok"}`,
		"no token":     `{"username":"station"}`,
		"both missing": `{}`,
	} {
		srv, pushed := pushableServer()
		rec := httptest.NewRecorder()
		srv.routes().ServeHTTP(rec, pushRequest(body, shimSecret))

		if rec.Result().StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: answered %d, want 400", name, rec.Result().StatusCode)
		}
		if _, err := pushed.fetch(context.Background(), nil); err == nil {
			t.Fatalf("%s: was stored anyway", name)
		}
	}
}

// An expired push is reported, not quietly fallen back on. The app pushes a fresh login every time
// it resolves a track, so an expired one means it stopped pushing — which is the thing worth saying.
func TestAnExpiredPushIsReportedRatherThanUsed(t *testing.T) {
	pushed := &pushedCredentials{fallback: staticCredentials{}}
	pushed.store("station", "tok", time.Now().Add(-time.Minute))

	_, err := pushed.fetch(context.Background(), nil)
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("fetch on an expired push returned %v, want an expiry error", err)
	}
}

// Until the app pushes, whatever was configured at startup still answers — which is what keeps
// one-shot debugging (`-username`/`-token`) working with no app in the picture at all.
func TestTheConfiguredSourceAnswersUntilTheFirstPush(t *testing.T) {
	pushed := &pushedCredentials{fallback: staticCredentials{username: "flag-user", token: "flag-token"}}

	creds, err := pushed.fetch(context.Background(), nil)
	if err != nil || creds.username != "flag-user" || creds.token != "flag-token" {
		t.Fatalf("fetch before any push returned %q/%q/%v, want the configured pair", creds.username, creds.token, err)
	}

	pushed.store("station", "tok", time.Time{})
	if creds, _ := pushed.fetch(context.Background(), nil); creds.username != "station" {
		t.Fatalf("fetch after a push returned %q, want the pushed account", creds.username)
	}
}

// What a push costs the live session. A different account must drop it (its accesspoint is
// authenticated as somebody else), while a refreshed token on the same account must not: the
// session is still valid, and dropping it would spend a login an hour for no reason.
func TestOnlyANewAccountCostsTheLiveSession(t *testing.T) {
	pushed := &pushedCredentials{fallback: staticCredentials{}}

	if account, credentials := pushed.store("station", "tok", time.Time{}); account || !credentials {
		t.Fatalf("first push reported account=%v credentials=%v, want false/true", account, credentials)
	}
	if account, credentials := pushed.store("station", "tok", time.Time{}); account || credentials {
		t.Fatalf("identical push reported account=%v credentials=%v, want false/false", account, credentials)
	}
	if account, credentials := pushed.store("station", "fresher", time.Time{}); account || !credentials {
		t.Fatalf("refreshed token reported account=%v credentials=%v, want false/true", account, credentials)
	}
	if account, credentials := pushed.store("someone-else", "tok", time.Time{}); !account || !credentials {
		t.Fatalf("new account reported account=%v credentials=%v, want true/true", account, credentials)
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
	if body := rec.Body.String(); body != `{"ok":true,"session":false,"storedLogin":false}`+"\n" {
		t.Fatalf("health said %q", body)
	}
}

// The authorize URL is copied into a browser BY HAND, so it has to survive being JSON-encoded.
//
// Go escapes `&` to `&` by default, which turns every query separator into part of the
// preceding value: Spotify then sees one enormous parameter and answers "response_type must be
// code". This is the whole reason writeJSON exists, and it is worth a test because the default is
// what any later handler will get by reaching for json.NewEncoder directly.
//
// Measured, not theorised: it is what the first real authorization against this code did.
func TestTheAuthorizeURLIsNotHTMLEscapedIntoUselessness(t *testing.T) {
	srv := &server{
		log:        &librespot.NullLogger{},
		secret:     secret,
		shimSecret: shimSecret,
		auth:       &authorizer{redirectURL: "http://127.0.0.1:3679/login", log: &librespot.NullLogger{}},
	}

	req := httptest.NewRequest("POST", "/authorize", nil)
	req.Header.Set("X-Spotify-Login-Secret", shimSecret)
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, req)

	if rec.Result().StatusCode != http.StatusOK {
		t.Fatalf("authorize answered %d, want 200", rec.Result().StatusCode)
	}

	body := rec.Body.String()
	var answer struct {
		AuthorizeURL string `json:"authorizeUrl"`
	}
	if err := json.Unmarshal([]byte(body), &answer); err != nil {
		t.Fatalf("authorize answered unparseable JSON: %v", err)
	}

	// The decoded URL has to appear VERBATIM in the raw body, which is the whole property: an
	// operator reads this out of curl by eye, not through a JSON decoder. Asserted this way round
	// rather than by searching for the escape sequence, because a test that has to spell the
	// escaped form is one edit away from spelling the plain ampersand instead — which every
	// correct URL contains, so it fails on exactly the output it is meant to accept.
	if !strings.Contains(body, answer.AuthorizeURL) {
		t.Fatalf("the authorize url is escaped in the response body, so copying it out loses every query parameter: %s", body)
	}
	parsed, err := url.Parse(answer.AuthorizeURL)
	if err != nil {
		t.Fatalf("authorize answered an unparseable url: %v", err)
	}
	if got := parsed.Query().Get("response_type"); got != "code" {
		t.Fatalf("response_type is %q, want code (query was %q)", got, parsed.RawQuery)
	}
	for _, param := range []string{"client_id", "code_challenge", "code_challenge_method", "state", "redirect_uri"} {
		if parsed.Query().Get(param) == "" {
			t.Fatalf("%s is missing from the authorize url (query was %q)", param, parsed.RawQuery)
		}
	}
}

// `storedLogin` is the field to read first when nothing plays, so it has to answer for the file
// rather than for whatever the last login attempt happened to do. Reported WITHOUT opening a
// session, for the same reason as the line above.
func TestHealthReportsAStoredLoginWithoutOpeningOne(t *testing.T) {
	store := &storedLogin{path: filepath.Join(t.TempDir(), "spotify-credentials.json"), next: staticCredentials{}, log: &librespot.NullLogger{}}
	if err := store.save("station", []byte("credential-blob")); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	srv := &server{
		log:      &librespot.NullLogger{},
		secret:   secret,
		store:    store,
		sessions: newSessionHolder(store, &librespot.NullLogger{}, nil),
	}
	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, httptest.NewRequest("GET", "/health", nil))

	if body := rec.Body.String(); body != `{"ok":true,"session":false,"storedLogin":true}`+"\n" {
		t.Fatalf("health said %q", body)
	}
}

// Which failures are about the TRACK rather than the connection carrying it. This decided nothing
// but a reconnect until the answer started deciding a status code as well: the app writes a copy off
// FOR GOOD on the 410 this now produces, and reads every other failure as worth retrying. A false
// positive here permanently benches a record over a dropped connection.
func TestFailuresAboutTheTrackAreToldFromFailuresAboutTheConnection(t *testing.T) {
	unplayable := []string{
		`"Me So Horny" is not playable by this account (no audio files on the track or any of its 0 alternative(s))`,
		"no Ogg Vorbis file for this track",
		"invalid track uri",
	}
	for _, msg := range unplayable {
		if !isUnplayable(errors.New(msg)) {
			t.Fatalf("expected %q to be about the track", msg)
		}
	}

	// Every one of these was in this install's shim log, and every one is worth another attempt: an
	// audio-key quota, a dropped accesspoint, a login that needs redoing.
	retryable := []string{
		"failed retrieving audio key: 5",
		"failed reading packet header: EOF",
		"dial tcp 34.158.255.62:4070: connect: connection reset by peer",
		"failed authenticating with login5: 429",
		"failed getting track metadata: invalid status code 500",
	}
	for _, msg := range retryable {
		if isUnplayable(errors.New(msg)) {
			t.Fatalf("expected %q to be worth retrying", msg)
		}
	}
}
