package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	librespot "github.com/devgianlu/go-librespot"
	"github.com/devgianlu/go-librespot/ap"
	"github.com/devgianlu/go-librespot/apresolve"
	"github.com/devgianlu/go-librespot/audio"
	pbdata "github.com/devgianlu/go-librespot/proto/spotify/clienttoken/data/v0"
	pbhttp "github.com/devgianlu/go-librespot/proto/spotify/clienttoken/http/v0"
	"github.com/devgianlu/go-librespot/spclient"
	"google.golang.org/protobuf/proto"
)

// The Spotify half: logging in as the station's account and keeping that login usable.

// The subset of a go-librespot session a fetch needs. Assembled here rather than taken from
// session.Session, which hides both of these behind unexported fields with no accessors (and Go's
// unexported is package-scoped, so being in the same module would not help).
type session struct {
	accesspoint *ap.Accesspoint
	sp          *spclient.Spclient
	keys        *audio.KeyProvider
}

func (s *session) close() {
	if s != nil && s.accesspoint != nil {
		s.accesspoint.Close()
	}
}

// Holds the one live session, builds it on demand, and rebuilds it after a failure.
//
// Lazy rather than built at startup on purpose: the shim comes up with the container, while the
// app (which mints the credentials) may not be there yet, and a station in Navidrome mode never
// needs a Spotify login at all. Nothing here should keep a session warm by polling either. The
// accesspoint connection is long-lived but not immortal, so the only reliable signal that it has
// gone is a request failing on it, which is what invalidate() is for.
type sessionHolder struct {
	mu      sync.Mutex
	current *session
	// Failures are remembered so an unreachable app or a rejected login cannot become a
	// reconnect storm against Spotify.
	lastFailure time.Time
	backoff     time.Duration
	// Why the last login attempt failed, for the health probe.
	//
	// A station that cannot play anything shows up as a fetch timing out and a queue that never
	// advances, and the reason is several layers down. Keeping it here means one HTTP call
	// answers "why is nothing playing", instead of a log dig through a wall of backoff lines
	// that all say the same thing.
	lastError string

	creds  credentialSource
	log    librespot.Logger
	client *http.Client
}

const (
	minBackoff = 2 * time.Second
	maxBackoff = 60 * time.Second
)

// get() refusing to attempt anything, as opposed to attempting one and being refused by Spotify.
//
// Its own type so a caller can tell the two apart, which matters for exactly one decision: whether
// the failure is worth telling an operator about. Being held off is this shim working — the login
// that failed has already been reported — and warning per request would bury that one report under
// a line per track.
type holdingOff struct{ wait time.Duration }

func (e holdingOff) Error() string {
	return fmt.Sprintf("holding off %s after a failed login", e.wait.Round(time.Millisecond))
}

func newSessionHolder(creds credentialSource, log librespot.Logger, client *http.Client) *sessionHolder {
	return &sessionHolder{creds: creds, log: log, client: client}
}

// The live session, connecting first if there isn't one. Single-flight: a second request arriving
// mid-connect waits rather than opening a second login.
func (h *sessionHolder) get(ctx context.Context) (*session, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.current != nil {
		return h.current, nil
	}
	if wait := time.Until(h.lastFailure.Add(h.backoff)); wait > 0 {
		return nil, holdingOff{wait: wait}
	}

	username, token, err := h.creds.fetch(ctx, h.client)
	if err != nil {
		h.noteFailure(err)
		return nil, err
	}
	sess, err := connect(ctx, h.log, h.client, username, token, h.bearer())
	if err != nil {
		h.noteFailure(err)
		return nil, err
	}
	h.current, h.backoff, h.lastError = sess, 0, ""
	return sess, nil
}

// Warm the session in the background, so a login that has to happen anyway does not happen inside
// the fetch of an item that is about to air.
//
// Errors are dropped rather than returned: this is speculative work, and the fetch path opens (and
// reports) its own session if this never succeeded. The backoff in get() still applies, so a station
// whose credentials are rejected does not turn every push into another login attempt.
//
// **Reported at warn, not debug.** A rejected login here is the same rejection the fetch path would
// hit, and it is the only place the REASON appears at all: once the backoff is set, every later
// request reports "holding off ..." and the cause is never printed again. Logging it quietly is how
// a station that cannot play anything presents as an unexplained sixty-second cycle. Holding off is
// not itself worth a warning — it is this shim working as intended — so that one stays quiet.
func (h *sessionHolder) warm(timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if _, err := h.get(ctx); err != nil {
		var held holdingOff
		if errors.As(err, &held) {
			h.log.WithError(err).Debugf("not warming the session yet")
			return
		}
		h.log.WithError(err).Warnf("could not log in to Spotify; the station cannot fetch tracks until this succeeds")
	}
}

// The bearer spclient should present, read fresh on every call.
//
// It is the app's own access token for this account: the one the console holds, refreshes, and
// pushes here on every resolve. Reading it per call rather than closing over the one that opened
// the session is what keeps a long-lived session usable — the token that authenticated the
// accesspoint expires in an hour, and the accesspoint does not.
//
// `force` is ignored because there is nothing here to force: refreshing belongs to the app, which
// does it on its own clock and pushes the result. An expired push is reported by the source rather
// than papered over, so spclient fails with a reason instead of a 401.
func (h *sessionHolder) bearer() librespot.GetLogin5TokenFunc {
	return func(ctx context.Context, _ bool) (string, error) {
		_, token, err := h.creds.fetch(ctx, h.client)
		return token, err
	}
}

// Why the last login attempt failed, or "" if the last one succeeded. For the health probe.
func (h *sessionHolder) failure() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.lastError
}

// Drop any live session and forget the backoff, so the next request logs in again from scratch.
// For a push that names a DIFFERENT account: the live accesspoint is authenticated as the old one,
// and every track it serves after that would come from the wrong library.
func (h *sessionHolder) reset() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.current.close()
	h.current = nil
	h.lastFailure, h.backoff, h.lastError = time.Time{}, 0, ""
}

// Forget the backoff without touching a live session.
//
// For a push carrying a NEW token on the same account. The backoff exists to stop a rejected login
// becoming a reconnect storm, and a rejected login is exactly what fresh credentials might fix, so
// holding one off after a push would make the shim wait out a delay whose reason has just been
// addressed. The session itself is left alone: an authenticated accesspoint does not stop being
// authenticated because the token that opened it was refreshed.
func (h *sessionHolder) clearBackoff() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lastFailure, h.backoff = time.Time{}, 0
}

// Drop the session so the next request builds a fresh one. Called when a fetch fails on it: an
// accesspoint that has gone away fails every later request identically until it is replaced.
func (h *sessionHolder) invalidate(dead *session) {
	h.mu.Lock()
	defer h.mu.Unlock()
	// Only if it is still the one we handed out; a concurrent request may already have replaced it.
	if h.current == dead {
		h.current = nil
		dead.close()
	}
}

// Whether a login is currently established, for the health probe. Deliberately does not connect.
func (h *sessionHolder) live() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.current != nil
}

func (h *sessionHolder) shutdown() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.current.close()
	h.current = nil
}

func (h *sessionHolder) noteFailure(err error) {
	h.lastFailure = time.Now()
	h.lastError = err.Error()

	switch {
	case h.backoff == 0:
		h.backoff = minBackoff
	case h.backoff < maxBackoff:
		h.backoff *= 2
	}
	if h.backoff > maxBackoff {
		h.backoff = maxBackoff
	}
}

// Log in as the station's account and stand up the two clients a fetch needs. This mirrors
// session.NewSessionFromOptions, minus the dealer, mercury, the event manager AND the login5
// exchange: nothing here registers a Connect device or announces a player, which is the point. The
// account is the same one the console is linked to: the app pushes its login (see
// pushedCredentials).
func connect(ctx context.Context, log librespot.Logger, client *http.Client, username, token string, bearer librespot.GetLogin5TokenFunc) (*session, error) {
	deviceId, err := randomDeviceId()
	if err != nil {
		return nil, err
	}

	clientToken, err := retrieveClientToken(client, deviceId)
	if err != nil {
		return nil, fmt.Errorf("failed obtaining client token: %w", err)
	}

	resolver := apresolve.NewApResolver(log, client)
	apAddr, err := resolver.GetAccesspoint(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed resolving accesspoint: %w", err)
	}

	accesspoint := ap.NewAccesspoint(log, apAddr, deviceId)
	if err := accesspoint.ConnectSpotifyToken(ctx, username, token); err != nil {
		return nil, fmt.Errorf("failed authenticating accesspoint: %w", err)
	}

	spAddr, err := resolver.GetSpclient(ctx)
	if err != nil {
		accesspoint.Close()
		return nil, fmt.Errorf("failed resolving spclient: %w", err)
	}

	// **No login5 exchange, and that is a deliberate departure from upstream.**
	//
	// The session assembly this is transcribed from exchanges the accesspoint's stored credentials
	// through login5 for a bearer, and this did too. But login5 validates those credentials against
	// the client the CLIENT TOKEN belongs to — go-librespot's own hard-coded id — while the
	// accesspoint here was authenticated with a token minted by the OPERATOR's Spotify app. Spotify
	// tolerated that pairing until 2026-08-09 and then began answering INVALID_CREDENTIALS, which
	// takes the station off the air completely: every track fails to open and the running order
	// never advances.
	//
	// That exchange bought exactly one thing — a bearer for spclient — and the app already holds
	// one for the same account, refreshes it, and pushes it here on every resolve. So spclient is
	// given that instead, and the two halves of the login stop belonging to different clients. The
	// audio key rides the accesspoint connection and never went through login5 at all, so nothing
	// about decryption changes.
	sp, err := spclient.NewSpclient(ctx, log, client, spAddr, bearer, deviceId, clientToken)
	if err != nil {
		accesspoint.Close()
		return nil, fmt.Errorf("failed initializing spclient: %w", err)
	}

	// The audio key provider rides on the accesspoint connection, NOT on the Web API. This is the
	// path that still works without a PlayPlay implementation: the shipped plugin is a stub
	// (IsSupported() == false), which only rules out FLAC. Ogg Vorbis keys come from here.
	return &session{accesspoint: accesspoint, sp: sp, keys: audio.NewAudioKeyProvider(log, accesspoint)}, nil
}

// ── credentials ──────────────────────────────────────────────────────────────

// Where a login comes from. Two implementations: whatever the app last pushed (how the container
// runs) and a fixed pair passed on the command line (how an operator debugs one track).
type credentialSource interface {
	fetch(ctx context.Context, client *http.Client) (username, token string, err error)
}

// The last login the app pushed to POST /session.
//
// This is the direction the arrangement runs in: the app resolves a rundown item, and hands over a
// login on the way past. A push therefore lands minutes before the fetch it is for, which is what
// makes a stored token safe to reuse — it is never much older than the track it opens.
//
// `fallback` is whatever was passed on the command line, used until the first push arrives, so
// one-shot mode works with no app in the picture at all.
type pushedCredentials struct {
	mu        sync.Mutex
	username  string
	token     string
	expiresAt time.Time
	fallback  credentialSource
}

func (c *pushedCredentials) fetch(ctx context.Context, client *http.Client) (string, string, error) {
	c.mu.Lock()
	username, token, expiresAt := c.username, c.token, c.expiresAt
	c.mu.Unlock()

	if username == "" || token == "" {
		return c.fallback.fetch(ctx, client)
	}
	// Reported rather than fallen back on. An expired push means the app stopped pushing (it is
	// down, or the station has been off air for longer than a token lives), and saying so names the
	// cause; the next resolve pushes a fresh one on its own.
	if !expiresAt.IsZero() && time.Now().After(expiresAt) {
		return "", "", fmt.Errorf("the pushed login expired at %s; the app pushes a fresh one when it next resolves a track", expiresAt.UTC().Format(time.RFC3339))
	}
	return username, token, nil
}

// Record a pushed login, reporting what about it changed: whether it names a different account, and
// whether it is different at all. The two answers cost the session different things — see
// {@link sessionHolder.reset} and {@link sessionHolder.clearBackoff}.
func (c *pushedCredentials) store(username, token string, expiresAt time.Time) (accountChanged, credentialsChanged bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	accountChanged = c.username != "" && c.username != username
	credentialsChanged = c.username != username || c.token != token
	c.username, c.token, c.expiresAt = username, token, expiresAt
	return accountChanged, credentialsChanged
}

type staticCredentials struct{ username, token string }

func (c staticCredentials) fetch(context.Context, *http.Client) (string, string, error) {
	if c.username == "" || c.token == "" {
		return "", "", fmt.Errorf("no credentials: wait for the app to push a login, or pass -username and -token")
	}
	return c.username, c.token, nil
}

// A client token for the spclient calls. Copied from session.retrieveClientToken, which is
// unexported (and unreachable even from a package inside the module, since Go's unexported is
// package-scoped). Everything it touches is exported, so this is a transcription, not a
// reimplementation.
func retrieveClientToken(c *http.Client, deviceId string) (string, error) {
	body, err := proto.Marshal(&pbhttp.ClientTokenRequest{
		RequestType: pbhttp.ClientTokenRequestType_REQUEST_CLIENT_DATA_REQUEST,
		Request: &pbhttp.ClientTokenRequest_ClientData{
			ClientData: &pbhttp.ClientDataRequest{
				ClientId:      librespot.ClientIdHex,
				ClientVersion: librespot.SpotifyLikeClientVersion(),
				Data: &pbhttp.ClientDataRequest_ConnectivitySdkData{
					ConnectivitySdkData: &pbdata.ConnectivitySdkData{
						DeviceId:             deviceId,
						PlatformSpecificData: librespot.GetPlatformSpecificData(),
					},
				},
			},
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed marshalling ClientTokenRequest: %w", err)
	}

	reqUrl, err := url.Parse("https://clienttoken.spotify.com/v1/clienttoken")
	if err != nil {
		return "", fmt.Errorf("invalid clienttoken url: %w", err)
	}

	resp, err := c.Do(&http.Request{
		Method: "POST",
		URL:    reqUrl,
		Header: http.Header{
			"Accept":     []string{"application/x-protobuf"},
			"User-Agent": []string{librespot.UserAgent()},
		},
		Body: io.NopCloser(bytes.NewReader(body)),
	})
	if err != nil {
		return "", fmt.Errorf("failed requesting clienttoken: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("invalid status code from clienttoken: %d", resp.StatusCode)
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed reading clienttoken response: %w", err)
	}

	var protoResp pbhttp.ClientTokenResponse
	if err := proto.Unmarshal(respBody, &protoResp); err != nil {
		return "", fmt.Errorf("failed unmarshalling clienttoken response: %w", err)
	}
	if protoResp.ResponseType != pbhttp.ClientTokenResponseType_RESPONSE_GRANTED_TOKEN_RESPONSE {
		return "", fmt.Errorf("unexpected clienttoken response type: %v", protoResp.ResponseType)
	}
	return protoResp.GetGrantedToken().Token, nil
}

func randomDeviceId() (string, error) {
	buf := make([]byte, 20) // the accesspoint rejects any other length
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed generating device id: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
