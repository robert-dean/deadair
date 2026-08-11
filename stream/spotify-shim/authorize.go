package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"sync"
	"time"

	librespot "github.com/devgianlu/go-librespot"
	"golang.org/x/oauth2"
	spotifyoauth2 "golang.org/x/oauth2/spotify"
)

// Getting this shim credentials of its OWN, which is the only kind login5 accepts.
//
// The station's account is already linked in the console, and for a year the arrangement was to
// lend that link's access token to this shim. It stopped working, and the reason is structural
// rather than a fault: an access token is minted FOR a client, the client token this shim presents
// is minted for the streaming client id, and login5 validates one against the other. The operator's
// own Spotify app is not that client, so the pairing is refused however valid each half is on its
// own. (Both halves were verified good at the time: the accesspoint authenticated 208 times while
// every login5 exchange was refused, and the same token answered the Web API.)
//
// So the shim authorizes itself, once, against the streaming client id, and keeps what comes back.
// The operator opens a URL and approves; the accesspoint hands over a reusable credential blob;
// that blob goes to disk and every login after this one uses it. Nothing here is per-track, per-boot
// or on any deadline — it happens once per station.
//
// Deliberately NOT a refresh-token dance. The blob the accesspoint returns is the durable thing
// (see storedLogin) and it does not expire the way an OAuth token does, so there is nothing to
// renew and no schedule to keep. The OAuth exchange exists only to get far enough to be handed one.

// Where Spotify sends the operator's browser back to.
//
// The path is the library's own, and the port is this shim's own listener, so the callback is just
// another route on the mux that is already running. Two things follow, and both are load-bearing:
// there is no second HTTP server to start and stop around an authorization, and the address is one
// compose already publishes on the host, which is what makes it reachable from the browser the
// operator is sitting at.
const authorizeCallbackPath = "/login"

// How long an authorization may sit half-finished before its code is refused.
//
// It exists to bound a pending exchange, not to hurry anybody: an operator who opens the URL and
// then goes to make tea should still land. What it stops is a verifier for an authorization nobody
// finished staying live indefinitely.
const authorizePendingTTL = 15 * time.Minute

// The scopes asked for, which are the library's own list verbatim.
//
// Kept whole rather than trimmed to what a track fetch needs. This shim only reads audio, so most
// of these are surplus on the face of it — but the exchange here is a means to a credential blob
// rather than an end, what Spotify requires to issue one that satisfies login5 is not documented
// anywhere we can read, and this repo has already spent a day on one departure from that assembly
// that turned out to have no reason behind it. Trimming is a follow-up for once this is known to
// work, with the list that worked recorded first.
var authorizeScopes = []string{
	"app-remote-control",
	"playlist-modify",
	"playlist-modify-private",
	"playlist-modify-public",
	"playlist-read",
	"playlist-read-collaborative",
	"playlist-read-private",
	"streaming",
	"ugc-image-upload",
	"user-follow-modify",
	"user-follow-read",
	"user-library-modify",
	"user-library-read",
	"user-modify",
	"user-modify-playback-state",
	"user-modify-private",
	"user-personalized",
	"user-read-birthdate",
	"user-read-currently-playing",
	"user-read-email",
	"user-read-play-history",
	"user-read-playback-position",
	"user-read-playback-state",
	"user-read-private",
	"user-read-recently-played",
	"user-top-read",
}

// Drives the one-time authorization and holds the half of it that is in flight.
type authorizer struct {
	mu      sync.Mutex
	pending *pendingAuthorization

	// The redirect Spotify is told about, which MUST be byte-identical to the one sent on the
	// exchange or the exchange is refused.
	redirectURL string
	store       *storedLogin
	sessions    *sessionHolder
	log         librespot.Logger
	client      *http.Client
}

type pendingAuthorization struct {
	verifier  string
	state     string
	url       string
	startedAt time.Time
}

func (a *authorizer) config() *oauth2.Config {
	return &oauth2.Config{
		ClientID:    librespot.ClientIdHex,
		RedirectURL: a.redirectURL,
		Scopes:      authorizeScopes,
		Endpoint:    spotifyoauth2.Endpoint,
	}
}

// Start an authorization and return the URL the operator has to open.
//
// Replaces any authorization already pending rather than refusing: an operator asking again is
// almost always one who lost the URL or let it go stale, and making them wait out a TTL for that
// would be answering a reasonable request with a puzzle. The replaced verifier dies with it, so the
// old URL stops working — which is the honest behaviour, since only one of them can be completed.
func (a *authorizer) begin() (string, error) {
	state, err := randomState()
	if err != nil {
		return "", err
	}

	verifier := oauth2.GenerateVerifier()
	url := a.config().AuthCodeURL(state, oauth2.S256ChallengeOption(verifier))

	a.mu.Lock()
	a.pending = &pendingAuthorization{verifier: verifier, state: state, url: url, startedAt: time.Now()}
	a.mu.Unlock()

	// At info and in full, because this URL is the whole point and the operator has to be able to
	// find it: a station in this state cannot play anything, and the log is where somebody looks.
	a.log.Infof("to authorize Spotify for this station, open: %s", url)
	return url, nil
}

// The URL of an authorization still waiting to be completed, for the health probe.
//
// Nil-tolerant for the same reason as storedLogin.present: a health probe must not depend on how
// completely the server around it was assembled.
func (a *authorizer) pendingURL() string {
	if a == nil {
		return ""
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pending == nil || time.Since(a.pending.startedAt) > authorizePendingTTL {
		return ""
	}
	return a.pending.url
}

// Finish an authorization: exchange the code, log in on it, and keep what the accesspoint gives back.
//
// The session it builds is installed as the live one, so the station can play the moment this
// returns rather than on the next backoff tick. Its credential blob is what every later login uses.
func (a *authorizer) complete(ctx context.Context, code, state string) (string, error) {
	// Taken and cleared together: an authorization code is single-use, and leaving the pending
	// state in place would invite a second attempt that can only fail confusingly.
	a.mu.Lock()
	pending := a.pending
	a.pending = nil
	a.mu.Unlock()

	if pending == nil {
		return "", fmt.Errorf("no authorization is pending; start one with POST /authorize")
	}
	if time.Since(pending.startedAt) > authorizePendingTTL {
		return "", fmt.Errorf("this authorization expired after %s; start another with POST /authorize", authorizePendingTTL)
	}
	// Constant-time, and checked before the code is spent: this handler is reachable by anything
	// that can hit the published port, and `state` is the only thing tying a callback to the
	// authorization this shim actually started.
	if subtle.ConstantTimeCompare([]byte(state), []byte(pending.state)) != 1 {
		return "", fmt.Errorf("this callback does not match the authorization that was started")
	}
	if code == "" {
		return "", fmt.Errorf("Spotify sent no authorization code back")
	}

	// Through this shim's own client, so the exchange inherits the timeout everything else here
	// runs under rather than oauth2's default of none.
	token, err := a.config().Exchange(context.WithValue(ctx, oauth2.HTTPClient, a.client), code, oauth2.VerifierOption(pending.verifier))
	if err != nil {
		return "", fmt.Errorf("failed exchanging the authorization code: %w", err)
	}

	// Spotify returns the account name alongside the token on this grant. Asserted rather than
	// assumed: without it there is nothing to authenticate the accesspoint AS, and a failed type
	// assertion here would take the whole shim down over a field Spotify chose not to send.
	username, _ := token.Extra("username").(string)
	if username == "" {
		return "", fmt.Errorf("the token exchange carried no username, so there is no account to log in as")
	}

	sess, err := a.sessions.establish(ctx, login{username: username, token: token.AccessToken})
	if err != nil {
		return "", fmt.Errorf("the authorization succeeded but the login did not: %w", err)
	}

	// Taken from the ACCESSPOINT rather than from the token: this blob is what it will accept back
	// on a later `ConnectStored`, and it is the only durable half of what just happened.
	if err := a.store.save(sess.accesspoint.Username(), sess.accesspoint.StoredCredentials()); err != nil {
		// The session is live and the station can play right now, so this is not fatal to this
		// boot — it is fatal to the next one, which is exactly what to say.
		a.log.WithError(err).Errorf("authorized Spotify but could not keep the login; it will be lost on the next restart")
		return username, nil
	}

	a.log.Infof("authorized Spotify as %s and kept the login; the station no longer needs a pushed token", username)
	return username, nil
}

func randomState() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed generating an authorization state: %w", err)
	}
	return hex.EncodeToString(buf), nil
}
