package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// The HTTP half: one track per request, so Liquidsoap's request.queue can fetch a Spotify track
// the same way it fetches a pre-signed Subsonic URL.
//
//	GET  /health              → {"ok":true,"session":false,"storedLogin":true,"loginError":"..."}
//	POST /authorize           ← start this shim's own one-time Spotify authorization
//	GET  /login?code=         ← where Spotify sends the operator's browser back (see authorize.go)
//	POST /authorize/complete  ← the same callback, relayed by something that is not that browser
//	POST /session             ← the app hands over a Spotify login (the fallback path)
//	GET  /track/{id}?t=       → the track as audio/ogg
//
// Liquidsoap curl-downloads a queued item with NO headers from us, which is why the authorization
// rides in the query string. Same constraint the app's rendered-segment route already works
// under (playout.urls.ts).

type server struct {
	sessions *sessionHolder
	client   *http.Client
	log      librespot.Logger
	// Signs and verifies track URLs. Shared with the app as PLAYOUT_BRIDGE_SECRET, the same secret
	// gating Liquidsoap's /control/* endpoints.
	secret string
	// Gates POST /session, and deliberately NOT the same secret as the one above: that one moves
	// track ids around, while this one decides whose Spotify account this shim fetches as. Shared
	// with the app as SPOTIFY_SHIM_SECRET.
	shimSecret string
	// Where a pushed login lands. The session holder reads through it, after the stored one.
	pushed *pushedCredentials
	// This shim's own authorization: the store it writes to, and the flow that fills it.
	store   *storedLogin
	auth    *authorizer
	bitrate int
	// How long a fetch may take before it is abandoned. Generous: a track arrives in about a
	// second, but a cold session has a login in front of it.
	fetchTimeout time.Duration
}

func (s *server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST /authorize", s.handleAuthorize)
	// The callback is a GET from the operator's BROWSER, so it cannot carry the login secret the
	// other control routes are gated on: a redirect from Spotify sends no headers of ours. What
	// stands in for it is the `state` this shim generated, checked in authorizer.complete.
	mux.HandleFunc("GET "+authorizeCallbackPath, s.handleAuthorizeCallback)
	// The same callback for a browser that could not deliver it. Gated on the login secret, which
	// the GET above cannot be and this one must be: the browser's own request is authenticated by
	// the `state` it carries, and a relay is a caller we can hold to a higher bar for free.
	mux.HandleFunc("POST /authorize/complete", s.handleAuthorizeComplete)
	mux.HandleFunc("POST /session", s.handleSession)
	mux.HandleFunc("GET /track/{id}", s.handleTrack)
	// HEAD needs its OWN pattern. Go's router matches HEAD against a "GET" pattern, so without
	// this the full handler answers it: Liquidsoap sniffs each item with a HEAD before
	// downloading it, and every track cost two metadata lookups, two audio keys and two CDN
	// readers for a response whose body is thrown away.
	mux.HandleFunc("HEAD /track/{id}", s.handleTrackHead)
	return mux
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	// Reports whether a login is CURRENTLY established, and never establishes one: a health probe
	// that logs in would make every container restart hit Spotify whether or not the station is
	// even in Spotify mode.
	//
	// `loginError` is the last reason a login was refused, and it is the whole point of probing
	// this while nothing plays: without it a station that cannot fetch a single track looks
	// identical to one nobody has asked for anything yet, and the reason is buried under a wall of
	// identical backoff lines.
	//
	// `storedLogin` is the question underneath that one. A shim with no stored authorization is
	// running on the pushed token, which login5 refuses, so `false` here IS the diagnosis rather
	// than a detail — and `authorizeUrl` then says what to do about it.
	body := map[string]any{"ok": true, "session": s.sessions.live(), "storedLogin": s.store.present()}
	if failure := s.sessions.failure(); failure != "" {
		body["loginError"] = failure
	}
	if url := s.auth.pendingURL(); url != "" {
		body["authorizeUrl"] = url
	}
	// The address the browser will be sent to, which on most deployments is one it cannot load. Said
	// here because this process is the only thing that knows it — it is derived from the listen
	// address — and a console warning an operator which page is expected to fail must not guess.
	if url := s.auth.callbackURL(); url != "" {
		body["callbackUrl"] = url
	}
	writeJSON(w, body)
}

// Encode a response body WITHOUT Go's default HTML escaping.
//
// `json.Marshal` rewrites `&`, `<` and `>` as `&` and friends, on the theory that the result
// might be interpolated into a page. Nothing here is, and one of these bodies carries an
// authorization URL an operator copies into a browser by hand — where `&` between every query
// parameter means Spotify sees one enormous parameter and answers "response_type must be code".
// Measured, not theorised: it is what the first real authorization did.
func writeJSON(w http.ResponseWriter, body any) {
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(body)
}

// Start this shim's own authorization and hand back the URL to open.
//
// Gated on the same secret as POST /session, and for the same reason: both decide whose Spotify
// account this shim fetches as. It answers with the URL rather than redirecting, because the caller
// is an operator with curl or the app relaying to a console, neither of which is a browser
// following a 302.
func (s *server) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	if s.shimSecret == "" {
		http.Error(w, "no login secret configured", http.StatusNotFound)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Spotify-Login-Secret")), []byte(s.shimSecret)) != 1 {
		s.log.Warnf("rejected an authorization request: the login secret did not match")
		http.Error(w, "denied", http.StatusUnauthorized)
		return
	}

	url, err := s.auth.begin()
	if err != nil {
		s.log.WithError(err).Errorf("could not start an authorization")
		http.Error(w, "could not start an authorization", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"authorizeUrl": url, "expiresInMs": authorizePendingTTL.Milliseconds()})
}

// Where Spotify sends the operator's browser once they have approved.
//
// Answers in plain text because a person is reading it, and says which account landed: an operator
// with two Spotify accounts in two browser profiles wants to know which one this station now is,
// and finding that out later means reading a log.
func (s *server) handleAuthorizeCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	if refusal := query.Get("error"); refusal != "" {
		s.log.Warnf("the operator's Spotify authorization was refused: %s", refusal)
		http.Error(w, fmt.Sprintf("Spotify refused the authorization: %s", refusal), http.StatusBadRequest)
		return
	}

	// Its own timeout rather than the request's: the exchange is followed by a full login, which is
	// several round trips, and a browser that gives up must not take the authorization with it.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), s.fetchTimeout)
	defer cancel()

	username, err := s.auth.complete(ctx, query.Get("code"), query.Get("state"))
	if err != nil {
		s.log.WithError(err).Errorf("failed completing the Spotify authorization")
		http.Error(w, fmt.Sprintf("The authorization did not complete: %v", err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = fmt.Fprintf(w, "Authorized as %s. This station can fetch its own tracks now; you can close this tab.\n", username)
}

// The body of POST /authorize/complete: the callback the operator's browser could not deliver.
//
// `redirectUrl` is the whole address, pasted out of the browser's own bar, and is the field the
// console actually sends. `code`/`state` are the same thing already taken apart, for a caller that
// has them separately. Parsed HERE rather than by each caller, because there is exactly one right
// way to read that URL and copies of it would drift.
type authorizationCompletion struct {
	RedirectURL string `json:"redirectUrl"`
	Code        string `json:"code"`
	State       string `json:"state"`
}

// Finish an authorization on behalf of a browser that could not reach this shim.
//
// ## Why this exists
//
// The redirect is `http://127.0.0.1:<port>/login` and cannot be moved: the client id is the
// streaming client's, which this project does not own and cannot register redirect URIs on, and
// loopback-with-any-port is the whole of what Spotify grants it. That address is reachable from the
// operator's browser only when the shim's port is published on the machine they are sitting at,
// which is true of the development compose stack and false of the production container, where one
// port is published and it is the edge's.
//
// So on every deployment but one, the operator approves in Spotify, lands on a page that cannot
// load, and the authorization is stranded one step from done. What this route does is let them hand
// the address over anyway. The exchange itself is unchanged, `state` still ties the callback to the
// authorization this shim started, and the fifteen-minute TTL still applies.
func (s *server) handleAuthorizeComplete(w http.ResponseWriter, r *http.Request) {
	if s.shimSecret == "" {
		http.Error(w, "no login secret configured", http.StatusNotFound)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Spotify-Login-Secret")), []byte(s.shimSecret)) != 1 {
		s.log.Warnf("rejected a relayed authorization: the login secret did not match")
		http.Error(w, "denied", http.StatusUnauthorized)
		return
	}

	var body authorizationCompletion
	// Capped like the session push beside it, and for the same reason.
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&body); err != nil {
		s.log.WithError(err).Warnf("rejected a malformed relayed authorization")
		http.Error(w, "malformed body", http.StatusBadRequest)
		return
	}

	code, state := body.Code, body.State
	if trimmed := strings.TrimSpace(body.RedirectURL); trimmed != "" {
		query, err := callbackQuery(trimmed)
		if err != nil {
			http.Error(w, "that does not look like the address Spotify sent the browser to", http.StatusBadRequest)
			return
		}
		// Spotify reports a refusal in the redirect rather than by failing it, so the operator has
		// pasted a perfectly well-formed URL that says no. Reported as itself: the alternative is
		// "Spotify sent no authorization code back", which reads as our fault.
		if refusal := query.Get("error"); refusal != "" {
			s.log.Warnf("the operator's Spotify authorization was refused: %s", refusal)
			http.Error(w, fmt.Sprintf("Spotify refused the authorization: %s", refusal), http.StatusBadRequest)
			return
		}
		code, state = query.Get("code"), query.Get("state")
	}

	// Its own timeout, for the reason the browser's callback has one: the exchange is followed by a
	// full login, and the caller giving up must not take the authorization with it.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), s.fetchTimeout)
	defer cancel()

	username, err := s.auth.complete(ctx, code, state)
	if err != nil {
		// 400 for the attempt, 502 for Spotify. The caller shows one of these to an operator who has
		// to decide whether pressing the button again is worth anything, and only one of them is.
		status := http.StatusBadGateway
		var refusal authorizationRefused
		if errors.As(err, &refusal) {
			status = http.StatusBadRequest
		}
		s.log.WithError(err).Errorf("failed completing a relayed Spotify authorization")
		http.Error(w, err.Error(), status)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"username": username})
}

// The query parameters off a pasted callback address.
//
// Generous about what it accepts, because what is being pasted is whatever the operator managed to
// select out of a browser that failed to load the page: the whole URL, the query string with its
// `?`, or the query string bare. All three carry the same two values, and refusing two of them
// would be refusing the operator for how far along the address bar they started dragging.
func callbackQuery(pasted string) (url.Values, error) {
	parsed, err := url.Parse(pasted)
	if err != nil {
		return nil, err
	}
	if parsed.RawQuery != "" {
		return parsed.Query(), nil
	}
	// No `?` in it at all, so this is either a bare query string or something that is not a callback.
	// `ParseQuery` tells those apart: the second has no `=` to find.
	return url.ParseQuery(pasted)
}

// The body of POST /session: the login the app lends this shim.
//
// `expiresAt` is unix MILLIseconds, matching the app's plugin boundary, where every timestamp is an
// integer in milliseconds. Omitted means "no expiry stated", which is honoured as "usable until
// Spotify says otherwise" rather than treated as already expired.
type sessionPush struct {
	Username    string `json:"username"`
	AccessToken string `json:"accessToken"`
	ExpiresAt   int64  `json:"expiresAt"`
}

// Take a Spotify login from the app.
//
// Answers 202 without waiting for the login itself. The caller is inside a plugin invocation with a
// deadline it has to resolve a track within, and a cold Spotify login is several round trips: this
// route exists to make the fetch that comes later fast, so blocking the resolve on it would spend
// the very budget it is trying to protect. The connection is warmed in the background instead, and
// the fetch path still opens its own session if that has not finished (or failed).
func (s *server) handleSession(w http.ResponseWriter, r *http.Request) {
	if s.shimSecret == "" {
		// Nothing could match, so this is not a refusal of this caller: the route cannot serve
		// anyone until the app seeds the secret. Mirrors what the app answers in the same state.
		http.Error(w, "no login secret configured", http.StatusNotFound)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Spotify-Login-Secret")), []byte(s.shimSecret)) != 1 {
		s.log.Warnf("rejected a session push: the login secret did not match")
		http.Error(w, "denied", http.StatusUnauthorized)
		return
	}

	var push sessionPush
	// Capped: this is a small JSON object, and an unbounded read on a route that accepts a body is
	// a way to spend the container's memory.
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&push); err != nil {
		s.log.WithError(err).Warnf("rejected a malformed session push")
		http.Error(w, "malformed body", http.StatusBadRequest)
		return
	}
	if push.Username == "" || push.AccessToken == "" {
		http.Error(w, "username and accessToken are both required", http.StatusBadRequest)
		return
	}

	var expiresAt time.Time
	if push.ExpiresAt > 0 {
		expiresAt = time.UnixMilli(push.ExpiresAt)
	}
	accountChanged, credentialsChanged := s.pushed.store(push.Username, push.AccessToken, expiresAt)

	switch {
	case accountChanged:
		s.log.Infof("took a session push for %s, replacing a session on a different account", push.Username)
		s.sessions.reset()
	case credentialsChanged:
		s.log.Infof("took a session push for %s", push.Username)
		s.sessions.clearBackoff()
	default:
		// The app pushes on every resolve, so most pushes say nothing new. Logging those at info
		// would put a line per track in the log for an event that changed nothing.
		s.log.Debugf("took a session push for %s, unchanged", push.Username)
	}

	w.WriteHeader(http.StatusAccepted)
	go s.sessions.warm(s.fetchTimeout)
}

// Answer a HEAD without touching Spotify.
//
// The only honest thing we could add by doing the work is Content-Length, and the GET that follows
// carries it anyway. What it would cost is a second metadata lookup, a second AUDIO KEY, and the
// first chunk off the CDN, for every item the player sniffs before downloading it. Audio keys are
// the scarce thing here, so the trade is not close.
//
// Still gated on the token: a HEAD confirms a track exists and is fetchable, which is not
// something an unauthenticated caller should be able to ask.
func (s *server) handleTrackHead(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := verifyToken(s.secret, id, r.URL.Query().Get("t"), time.Now()); err != nil {
		s.log.WithError(err).Warnf("rejected a head of %s", id)
		http.Error(w, "denied", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "audio/ogg")
	// Advertised because the GET honours Range (ServeContent does it off the SectionReader), and a
	// HEAD that hid that would be describing a different resource than the one we serve.
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
}

func (s *server) handleTrack(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := verifyToken(s.secret, id, r.URL.Query().Get("t"), time.Now()); err != nil {
		// One answer for a bad signature, an expired one and a missing one: a caller without the
		// secret learns nothing from the difference.
		s.log.WithError(err).Warnf("rejected a fetch of %s", id)
		http.Error(w, "denied", http.StatusUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.fetchTimeout)
	defer cancel()

	stream, err := s.openWithRetry(ctx, id)
	if err != nil {
		// 410, not 502, when the failure is about the TRACK rather than the connection carrying it:
		// this account has no audio for it and no alternative, so trying again next hour and every
		// hour after that will fail in exactly the same way.
		//
		// The distinction already existed for the reconnect decision (see isUnplayable) and used to
		// be thrown away here, on the argument that Liquidsoap treats every non-2xx alike. That
		// argument is spent: the app is now the only thing that fetches this endpoint, and it very
		// much cares — a 502 means "the upstream had a moment" and is retried, where this means
		// "never", and only the caller can act on the difference. It writes the copy off for good.
		if isUnplayable(err) {
			s.log.WithError(err).Warnf("this account cannot play %s, and no retry will change that", id)
			http.Error(w, "this account cannot play that track", http.StatusGone)
			return
		}

		// Everything else IS the connection: an audio-key quota, a dropped accesspoint, a login that
		// needs redoing. 502, not 500, because what failed is upstream of us.
		s.log.WithError(err).Errorf("failed opening %s", id)
		http.Error(w, "upstream fetch failed", http.StatusBadGateway)
		return
	}
	defer func() { _ = stream.Close() }()

	w.Header().Set("Content-Type", "audio/ogg")
	// Nothing about a track changes between fetches, but this is a private, secret-gated URL that
	// is different every time, so there is nothing useful for anyone to cache.
	w.Header().Set("Cache-Control", "no-store")
	s.log.Infof("serving %q by %s (%s, %d bytes)", stream.name, stream.artist, stream.format, stream.size)

	// Count what actually reaches the player. A log line at the START of a response says only that
	// we meant to serve it: a read that dies against the CDN halfway through leaves a truncated
	// body, and the player then drops the item and moves to the next one. From the app's side that
	// is indistinguishable from a track it simply never heard — the rundown treats "served but
	// never aired" as a normal skipped item and silently drops it — so if this is not reported
	// here, it is reported nowhere.
	started := time.Now()
	counter := &countingWriter{ResponseWriter: w}
	// ServeContent handles Content-Length, HEAD and Range off the SectionReader. Range matters
	// less for a queue that downloads whole items, but curl asking for one must not get a 200 with
	// the whole file when it expects a partial.
	http.ServeContent(counter, r, id+".ogg", time.Time{}, stream)

	elapsed := time.Since(started)
	// Only a whole-body request has a size to check against; a Range request is short by design.
	if r.Header.Get("Range") == "" && counter.written < stream.size {
		s.log.Warnf("truncated %q after %d of %d bytes in %s — the player will drop this item", stream.name, counter.written, stream.size, elapsed.Round(time.Millisecond))
		return
	}
	s.log.Debugf("served %q: %d bytes in %s", stream.name, counter.written, elapsed.Round(time.Millisecond))
}

// Wraps a ResponseWriter to count the body bytes actually written, so a transfer that dies
// partway is visible. ServeContent reports nothing about a write that fails: it simply stops.
type countingWriter struct {
	http.ResponseWriter
	written int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.ResponseWriter.Write(p)
	c.written += int64(n)
	return n, err
}

// Open a track, rebuilding the session once if the first attempt fails on a stale one.
//
// The retry is the point: an accesspoint connection that has quietly gone away fails every request
// on it identically, and the first one to notice is the fetch of an item that is about to air.
// Rather than failing that item and recovering on the next, we drop the session and try again on a
// fresh login, which costs about 300ms.
func (s *server) openWithRetry(ctx context.Context, id string) (*trackStream, error) {
	sess, err := s.sessions.get(ctx)
	if err != nil {
		return nil, err
	}
	stream, err := sess.openTrack(ctx, s.client, s.log, id, s.bitrate)
	if err == nil {
		return stream, nil
	}
	// A track this account cannot play is not a broken session; reconnecting would not help and
	// would spend a login on every unplayable item in the rundown.
	if ctx.Err() != nil || isUnplayable(err) {
		return nil, err
	}

	s.log.WithError(err).Warnf("fetch failed, retrying on a fresh session")
	s.sessions.invalidate(sess)
	sess, retryErr := s.sessions.get(ctx)
	if retryErr != nil {
		return nil, fmt.Errorf("%w (reconnect also failed: %v)", err, retryErr)
	}
	return sess.openTrack(ctx, s.client, s.log, id, s.bitrate)
}

// Whether the failure is about this track rather than the connection carrying it.
func isUnplayable(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "not playable by this account") ||
		strings.Contains(msg, "no Ogg Vorbis file") ||
		strings.Contains(msg, "is a ") || // an album/episode uri handed to a track endpoint
		strings.Contains(msg, "invalid track uri")
}
