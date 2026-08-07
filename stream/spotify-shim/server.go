package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// The HTTP half: one track per request, so Liquidsoap's request.queue can fetch a Spotify track
// the same way it fetches a pre-signed Subsonic URL.
//
//	GET  /health        → {"ok":true,"session":false}
//	POST /session       ← the app hands over a Spotify login
//	GET  /track/{id}?t= → the track as audio/ogg
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
	// with the app as SPOTIFY_LOGIN_SECRET.
	loginSecret string
	// Where a pushed login lands. The session holder reads through it.
	pushed  *pushedCredentials
	bitrate int
	// How long a fetch may take before it is abandoned. Generous: a track arrives in about a
	// second, but a cold session has a login in front of it.
	fetchTimeout time.Duration
}

func (s *server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
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
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "session": s.sessions.live()})
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
	if s.loginSecret == "" {
		// Nothing could match, so this is not a refusal of this caller: the route cannot serve
		// anyone until the app seeds the secret. Mirrors what the app answers in the same state.
		http.Error(w, "no login secret configured", http.StatusNotFound)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Spotify-Login-Secret")), []byte(s.loginSecret)) != 1 {
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
		// 502, not 500: what failed is upstream of us. Liquidsoap treats any non-2xx the same way
		// (the request fails to resolve and the item is dropped), so this is for the log.
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
