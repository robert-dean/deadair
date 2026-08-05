package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
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
	"github.com/devgianlu/go-librespot/login5"
	pbdata "github.com/devgianlu/go-librespot/proto/spotify/clienttoken/data/v0"
	pbhttp "github.com/devgianlu/go-librespot/proto/spotify/clienttoken/http/v0"
	credentialspb "github.com/devgianlu/go-librespot/proto/spotify/login5/v3/credentials"
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

	creds  credentialSource
	log    librespot.Logger
	client *http.Client
}

const (
	minBackoff = 2 * time.Second
	maxBackoff = 60 * time.Second
)

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
		return nil, fmt.Errorf("holding off %s after a failed login", wait.Round(time.Millisecond))
	}

	username, token, err := h.creds.fetch(ctx, h.client)
	if err != nil {
		h.noteFailure()
		return nil, err
	}
	sess, err := connect(ctx, h.log, h.client, username, token)
	if err != nil {
		h.noteFailure()
		return nil, err
	}
	h.current, h.backoff = sess, 0
	return sess, nil
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

func (h *sessionHolder) noteFailure() {
	h.lastFailure = time.Now()
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
// session.NewSessionFromOptions, minus the dealer, mercury and the event manager: nothing here
// registers a Connect device or announces a player, which is the point. The account is the same
// one the console is linked to: the app hands out its login (see loginCredentials).
func connect(ctx context.Context, log librespot.Logger, client *http.Client, username, token string) (*session, error) {
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

	l5 := login5.NewLogin5(log, client, deviceId, clientToken)
	if err := l5.Login(ctx, &credentialspb.StoredCredential{
		Username: accesspoint.Username(),
		Data:     accesspoint.StoredCredentials(),
	}); err != nil {
		accesspoint.Close()
		return nil, fmt.Errorf("failed authenticating with login5: %w", err)
	}

	spAddr, err := resolver.GetSpclient(ctx)
	if err != nil {
		accesspoint.Close()
		return nil, fmt.Errorf("failed resolving spclient: %w", err)
	}
	sp, err := spclient.NewSpclient(ctx, log, client, spAddr, l5.AccessToken(), deviceId, clientToken)
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

// Where a login comes from. Two implementations: the app's login route (how the container runs) and a
// fixed pair passed on the command line (how an operator debugs one track).
type credentialSource interface {
	fetch(ctx context.Context, client *http.Client) (username, token string, err error)
}

type staticCredentials struct{ username, token string }

func (c staticCredentials) fetch(context.Context, *http.Client) (string, string, error) {
	if c.username == "" || c.token == "" {
		return "", "", fmt.Errorf("no credentials: pass -username and -token, or -login-url to fetch them")
	}
	return c.username, c.token, nil
}

// Asks the app's internal, secret-gated login route for a username + access token, so the shim
// uses the account already linked in the console rather than a second set of secrets.
type loginCredentials struct{ url, secret string }

func (c loginCredentials) fetch(ctx context.Context, client *http.Client) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.url, nil)
	if err != nil {
		return "", "", fmt.Errorf("invalid login url: %w", err)
	}
	req.Header.Set("X-Spotify-Login-Secret", c.secret)

	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("login request failed (is the app up?): %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	switch resp.StatusCode {
	case 200:
	case 204:
		// Kept as a valid "nothing to give you" answer. The app currently prefers a 503 for
		// that case, which carries a reason a human can act on; this stays so an older or
		// newer app answering 204 is still reported rather than falling to the default.
		return "", "", fmt.Errorf("login route answered 204: the app has no Spotify login to mint")
	case 401:
		return "", "", fmt.Errorf("login route answered 401: the secret did not match stream.spotifyLoginSecret (it is SPOTIFY_LOGIN_SECRET in the materialized radio.env; rebuild the stream image if this container predates that rename)")
	case 404:
		return "", "", fmt.Errorf("login route answered 404: no login secret is seeded yet, so the endpoint is disabled")
	case 503:
		// The plugin is installed but not usable yet: not running, or nobody has authorised
		// Spotify in the console. Retryable, which the caller's backoff already handles.
		return "", "", fmt.Errorf("login route answered 503: Spotify is not connected in the console, so no login can be minted")
	default:
		return "", "", fmt.Errorf("login route returned %d", resp.StatusCode)
	}

	var body struct {
		Username    string `json:"username"`
		AccessToken string `json:"accessToken"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", "", fmt.Errorf("failed decoding the login response: %w", err)
	}
	if body.Username == "" || body.AccessToken == "" {
		return "", "", fmt.Errorf("login response carried no username/accessToken")
	}
	return body.Username, body.AccessToken, nil
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
