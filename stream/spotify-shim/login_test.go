package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

func storeAt(t *testing.T, next credentialSource) *storedLogin {
	t.Helper()
	return &storedLogin{path: filepath.Join(t.TempDir(), "spotify-credentials.json"), next: next, log: &librespot.NullLogger{}}
}

func pushedAt(username, token string) *pushedCredentials {
	pushed := &pushedCredentials{fallback: staticCredentials{}}
	pushed.store(username, token, time.Time{})
	return pushed
}

// The whole point of the file: once a station has authorized itself, that is what it logs in with,
// and the pushed token stops being consulted. They are not interchangeable — login5 refuses the
// pushed one — so preference order is the fix, not a convenience.
func TestAStoredLoginIsPreferredOverAPushedOne(t *testing.T) {
	store := storeAt(t, pushedAt("pushed-account", "pushed-token"))
	if err := store.save("stored-account", []byte{0x01, 0x02, 0x03}); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	creds, err := store.fetch(context.Background(), nil)
	if err != nil {
		t.Fatalf("fetch failed: %v", err)
	}
	if !creds.isStored() {
		t.Fatal("fetch returned a token login, want the stored one")
	}
	if creds.username != "stored-account" || string(creds.stored) != "\x01\x02\x03" {
		t.Fatalf("fetch returned %q/%v, want the stored pair", creds.username, creds.stored)
	}
	if creds.token != "" {
		t.Fatalf("fetch carried a token as well as stored credentials: %q", creds.token)
	}
}

// A station nobody has authorized yet is the ordinary state, not a fault: it falls through to
// whatever the app pushed, which is exactly how this shim behaved before it could authorize at all.
func TestNoStoredLoginFallsThroughToThePush(t *testing.T) {
	store := storeAt(t, pushedAt("pushed-account", "pushed-token"))

	creds, err := store.fetch(context.Background(), nil)
	if err != nil {
		t.Fatalf("fetch failed: %v", err)
	}
	if creds.isStored() || creds.username != "pushed-account" || creds.token != "pushed-token" {
		t.Fatalf("fetch returned %+v, want the pushed login", creds)
	}
}

// A file that cannot be read must not be able to take the station off air. Falling through leaves
// it exactly where it was before anyone authorized; refusing to log in at all would turn one
// corrupt file into silence.
func TestAnUnreadableStoredLoginFallsThroughRatherThanFailing(t *testing.T) {
	for name, body := range map[string]string{
		"not json":       `{`,
		"no username":    `{"credentials":"AQID"}`,
		"no credentials": `{"username":"station"}`,
		"empty object":   `{}`,
	} {
		store := storeAt(t, pushedAt("pushed-account", "pushed-token"))
		if err := os.WriteFile(store.path, []byte(body), 0o600); err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		creds, err := store.fetch(context.Background(), nil)
		if err != nil {
			t.Fatalf("%s: fetch failed: %v", name, err)
		}
		if creds.username != "pushed-account" {
			t.Fatalf("%s: fetch returned %+v, want the pushed login", name, creds)
		}
		if store.present() {
			t.Fatalf("%s: reported a stored login that cannot be read", name)
		}
	}
}

// This blob IS the account: anything holding it can fetch that library's audio.
func TestAStoredLoginIsWrittenPrivatelyAndSurvivesAReread(t *testing.T) {
	store := storeAt(t, staticCredentials{})
	if err := store.save("station", []byte("credential-blob")); err != nil {
		t.Fatalf("save failed: %v", err)
	}

	info, err := os.Stat(store.path)
	if err != nil {
		t.Fatalf("stat failed: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("stored login is mode %o, want 600", perm)
	}
	if !store.present() {
		t.Fatal("a saved login does not read back")
	}

	// Readable enough to diff and eyeball, which is why the blob is base64 rather than raw bytes.
	var file storedLoginFile
	raw, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("the stored login is not JSON: %v", err)
	}
	if file.Username != "station" || string(file.Credentials) != "credential-blob" {
		t.Fatalf("round-tripped %q/%q, want station/credential-blob", file.Username, file.Credentials)
	}
}

// Half a login is worse than none: it would read back as authorized and then fail at the
// accesspoint, which looks like Spotify refusing rather than like a file we wrote wrong.
func TestAnIncompleteLoginIsNotStored(t *testing.T) {
	store := storeAt(t, staticCredentials{})

	if err := store.save("", []byte("blob")); err == nil {
		t.Fatal("saved a login with no username")
	}
	if err := store.save("station", nil); err == nil {
		t.Fatal("saved a login with no credentials")
	}
	if store.present() {
		t.Fatal("a refused save left a file behind")
	}
}

// Nothing can be completed before something is started, and saying so names what to do about it.
func TestACallbackWithNoAuthorizationPendingIsRefused(t *testing.T) {
	auth := &authorizer{log: &librespot.NullLogger{}}

	_, err := auth.complete(context.Background(), "code", "state")
	if err == nil || !strings.Contains(err.Error(), "no authorization is pending") {
		t.Fatalf("complete with nothing pending returned %v, want a not-pending error", err)
	}
}

// The callback is reachable by anything that can hit the published port, and it cannot carry the
// login secret (a redirect from Spotify sends no headers of ours). `state` is the only thing tying
// a callback to the authorization this shim actually started, so a mismatch must refuse — and must
// refuse BEFORE the code is spent.
func TestACallbackWithTheWrongStateIsRefused(t *testing.T) {
	auth := &authorizer{log: &librespot.NullLogger{}}
	auth.pending = &pendingAuthorization{verifier: "v", state: "expected", url: "https://accounts.spotify.com/…", startedAt: time.Now()}

	_, err := auth.complete(context.Background(), "code", "forged")
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("complete with a forged state returned %v, want a mismatch error", err)
	}
}

// A pending authorization is single-use: leaving it in place after an attempt invites a second one
// that can only fail confusingly, since the code has already been spent.
func TestAPendingAuthorizationIsClearedByTheFirstAttempt(t *testing.T) {
	auth := &authorizer{log: &librespot.NullLogger{}}
	auth.pending = &pendingAuthorization{verifier: "v", state: "expected", url: "https://accounts.spotify.com/…", startedAt: time.Now()}

	_, _ = auth.complete(context.Background(), "code", "forged")

	if auth.pendingURL() != "" {
		t.Fatal("the authorization is still pending after an attempt")
	}
	if _, err := auth.complete(context.Background(), "code", "expected"); err == nil {
		t.Fatal("a second attempt was accepted")
	}
}

// An authorization nobody finished must not leave a live verifier behind indefinitely.
func TestAStaleAuthorizationExpires(t *testing.T) {
	auth := &authorizer{log: &librespot.NullLogger{}}
	auth.pending = &pendingAuthorization{
		verifier:  "v",
		state:     "expected",
		url:       "https://accounts.spotify.com/…",
		startedAt: time.Now().Add(-authorizePendingTTL - time.Minute),
	}

	if auth.pendingURL() != "" {
		t.Fatal("a stale authorization is still reported as pending")
	}
	if _, err := auth.complete(context.Background(), "code", "expected"); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("complete on a stale authorization returned %v, want an expiry error", err)
	}
}

// The redirect has to match byte for byte on both legs of the exchange, and it has to be an address
// the operator's BROWSER can reach — which is the loopback address compose publishes, not the
// address this process binds.
func TestTheCallbackURLIsDerivedFromTheListenAddress(t *testing.T) {
	for addr, want := range map[string]string{
		":3679":           "http://127.0.0.1:3679/login",
		"0.0.0.0:3679":    "http://127.0.0.1:3679/login",
		"127.0.0.1:14000": "http://127.0.0.1:14000/login",
		"nonsense":        "http://127.0.0.1:3679/login",
	} {
		if got := callbackURLFor("", addr); got != want {
			t.Fatalf("callbackURLFor(%q) = %q, want %q", addr, got, want)
		}
	}

	// A shim behind a proxy, or moved off the stream container, says so for itself.
	const explicit = "https://station.example/spotify/login"
	if got := callbackURLFor(explicit, ":3679"); got != explicit {
		t.Fatalf("an explicit callback url was overridden: %q", got)
	}
}
