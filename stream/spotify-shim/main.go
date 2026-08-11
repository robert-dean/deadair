// deadair-shim serves one Spotify track per HTTP request, so the station owns a track BEFORE it
// airs the way it owns a Navidrome one.
//
// Handed a fetchable URL, Liquidsoap downloads each item ahead of air into its own request queue,
// so Spotify runs on exactly the machinery Navidrome already uses: the playhead is the decoder's
// own reading, a break is an item in the running order, and a skip lands at once. It replaced
// go-librespot, which registered as a Connect device and streamed realtime PCM into Liquidsoap —
// an arrangement the app could only steer from the outside, with seconds of audio committed to
// the pipe at any moment.
//
// It is built ON go-librespot's own packages rather than reimplementing the protocol: the module
// has no internal/ directory, so session assembly, audio keys, the CDN reader and the decryptor
// are all importable. What it deliberately does NOT do is go through session.NewSessionFromOptions,
// whose Session keeps its spclient and key provider unexported with no accessors. See connect().
//
// Not importing player/vorbis is also what keeps this CGO-free: those pull in libvorbis/libogg via
// xlab/vorbis-go. We never decode. Spotify's file IS Ogg Vorbis once decrypted, so the only
// transform is dropping its custom first page (see trimMetadataPage).
//
// Two modes:
//
//	serve (default)   listen on -addr, answering GET /track/{id}?t=<signed>
//	one-shot (-uri)   fetch a single track to a file, for debugging a login or a track by hand
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Reaching Spotify: a login is several round trips, and a whole track arrives in about a second.
const httpClientTimeout = 30 * time.Second

func main() {
	addr := flag.String("addr", envOr("SHIM_ADDR", ":3679"), "listen address for serve mode")
	secret := flag.String("secret", os.Getenv("PLAYOUT_BRIDGE_SECRET"), "shared secret that signs track URLs (PLAYOUT_BRIDGE_SECRET)")
	shimSecret := flag.String("shim-secret", os.Getenv("SPOTIFY_SHIM_SECRET"), "X-Spotify-Login-Secret gating POST /session (SPOTIFY_SHIM_SECRET)")
	username := flag.String("username", "", "Spotify username, instead of waiting for the app to push one")
	token := flag.String("token", "", "Spotify access token, instead of waiting for the app to push one")
	credentials := flag.String("credentials", envOr("SHIM_CREDENTIALS", defaultCredentialsPath), "where this shim keeps its own Spotify authorization (SHIM_CREDENTIALS)")
	callbackURL := flag.String("callback-url", envOr("SHIM_CALLBACK_URL", ""), "where Spotify returns the operator's browser; defaults to http://127.0.0.1<addr>"+authorizeCallbackPath+" (SHIM_CALLBACK_URL)")
	bitrate := flag.Int("bitrate", envIntOr("SHIM_BITRATE", 320), "preferred bitrate; the nearest available Ogg file is used")
	fetchTimeout := flag.Duration("fetch-timeout", 90*time.Second, "how long one track fetch may take")
	uri := flag.String("uri", "", "one-shot mode: fetch this track and exit")
	out := flag.String("o", "", "one-shot mode: output file (default stdout)")
	sign := flag.String("sign", "", "print a signed URL path for this track id and exit")
	verbose := flag.Bool("v", false, "log go-librespot's own chatter")
	flag.Parse()

	cfg := options{
		addr: *addr, secret: *secret, shimSecret: *shimSecret,
		username: *username, token: *token,
		credentials: *credentials, callbackURL: *callbackURL,
		uri: *uri, out: *out, sign: *sign,
		bitrate: *bitrate, fetchTimeout: *fetchTimeout, verbose: *verbose,
	}
	if err := run(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "shim: %v\n", err)
		os.Exit(1)
	}
}

// Everything the two modes are configured with. A struct rather than a parameter list because the
// list was already eleven long and a positional call of that width is one transposition away from
// signing tokens with the login secret.
type options struct {
	addr, secret, shimSecret string
	username, token          string
	credentials, callbackURL string
	uri, out, sign           string
	bitrate                  int
	fetchTimeout             time.Duration
	verbose                  bool
}

func run(cfg options) error {
	// One-shot mode writes audio to stdout, so every diagnostic goes to stderr either way.
	var log librespot.Logger = &stderrLogger{quiet: !cfg.verbose}
	client := &http.Client{Timeout: httpClientTimeout}

	// The credential chain, in preference order. The stored authorization is this shim's own and is
	// the one login5 accepts; the pushed token is the fallback for a station nobody has authorized
	// yet; the command-line pair answers under both, which is what makes one-shot mode independent
	// of whether an app is running at all.
	pushed := &pushedCredentials{fallback: staticCredentials{username: cfg.username, token: cfg.token}}
	store := &storedLogin{path: cfg.credentials, next: pushed, log: log}
	sessions := newSessionHolder(store, log, client)

	srv := &server{
		sessions:   sessions,
		client:     client,
		log:        log,
		secret:     cfg.secret,
		shimSecret: cfg.shimSecret,
		pushed:     pushed,
		store:      store,
		auth: &authorizer{
			redirectURL: callbackURLFor(cfg.callbackURL, cfg.addr),
			store:       store,
			sessions:    sessions,
			log:         log,
			client:      client,
		},
		bitrate:      cfg.bitrate,
		fetchTimeout: cfg.fetchTimeout,
	}
	defer srv.sessions.shutdown()

	switch {
	case cfg.sign != "":
		// So an operator can curl a track by hand without recomputing the HMAC.
		if cfg.secret == "" {
			// Signing with an empty key succeeds and produces a token the running server rejects,
			// which reads as a bug in the auth rather than a missing variable. The trap is that
			// `docker compose exec` does NOT inherit the entrypoint shell's sourced radio.env.
			return fmt.Errorf("no signing secret in this process's environment; in the container run:\n" +
				"  sh -c 'set -a; . /streamconfig/radio.env; deadair-shim -sign <track-id>'")
		}
		fmt.Printf("/track/%s?t=%s\n", cfg.sign, signToken(cfg.secret, cfg.sign, time.Now().Add(tokenTTL)))
		return nil
	case cfg.uri != "":
		return fetchOnce(srv, cfg.uri, cfg.out)
	default:
		return serve(srv, cfg.addr, log)
	}
}

// Where this shim keeps its own authorization when nothing says otherwise.
//
// A writable volume of its own rather than /streamconfig, which is mounted read-only: that one is
// rendered BY the app from the database, and this file is the one piece of the stream container's
// state the app does not own and cannot reproduce.
const defaultCredentialsPath = "/streamstate/spotify-credentials.json"

// The redirect Spotify returns the operator's browser to.
//
// Derived from the listen address by default, because the two are the same door: compose publishes
// the shim's port on the host's loopback, so the address this process listens on is the address the
// operator's browser reaches it at. An explicit `-callback-url` covers the arrangements where that
// is not true — a shim behind a proxy, or one moved off the stream container.
//
// It has to match on BOTH legs of the exchange, so it is computed once here rather than at each
// use: a redirect that differs by so much as a trailing slash is refused, and the message Spotify
// answers with does not say which end was wrong.
func callbackURLFor(explicit, addr string) string {
	if explicit != "" {
		return explicit
	}
	// `addr` is a listen address, so the host half is empty (":3679") or a bind address that is not
	// necessarily reachable. Loopback is what compose publishes and what the browser can reach.
	_, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" {
		return "http://127.0.0.1:3679" + authorizeCallbackPath
	}
	return "http://127.0.0.1:" + port + authorizeCallbackPath
}

func serve(srv *server, addr string, log librespot.Logger) error {
	if srv.secret == "" {
		// Fail at startup rather than per request: a shim that cannot verify a signature can only
		// answer 401, and finding that out when the first item is due on air is far worse.
		return fmt.Errorf("no signing secret: set PLAYOUT_BRIDGE_SECRET (the app materializes it into radio.env)")
	}

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: the response IS a multi-megabyte track, and the per-fetch deadline in
		// the handler is the bound that matters.
	}

	// Stop cleanly on the signal the container sends, so a restart does not cut a download that a
	// queued item is waiting on.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	log.Infof("listening on %s", addr)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("server failed: %w", err)
	}
	return nil
}

// One-shot: fetch a track and write it out. This is the path the Phase 0 spike proved, kept as an
// operator tool for answering "is the login working, and is this track fetchable?" without
// involving Liquidsoap or the app.
func fetchOnce(srv *server, uri, out string) error {
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), srv.fetchTimeout)
	defer cancel()

	stream, err := srv.openWithRetry(ctx, uri)
	if err != nil {
		return err
	}
	defer func() { _ = stream.Close() }()
	fmt.Fprintf(os.Stderr, "shim: %s by %s (%s)\n", stream.name, stream.artist, stream.format)

	sink := io.Writer(os.Stdout)
	if out != "" {
		f, err := os.Create(out)
		if err != nil {
			return fmt.Errorf("failed creating %s: %w", out, err)
		}
		defer func() { _ = f.Close() }()
		sink = f
	}

	copied, err := io.Copy(sink, stream)
	if err != nil {
		return fmt.Errorf("failed writing audio: %w", err)
	}
	elapsed := time.Since(started)
	// The number the whole design hangs on: a track has to arrive comfortably faster than it
	// plays, or Liquidsoap cannot download it ahead of air.
	fmt.Fprintf(os.Stderr, "shim: wrote %d bytes in %s (%.1f Mbit/s)\n", copied, elapsed.Round(time.Millisecond), float64(copied*8)/elapsed.Seconds()/1e6)
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envIntOr(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return fallback
}

// A logger that puts diagnostics on stderr, so stdout stays pure audio in one-shot mode. Quiet
// drops go-librespot's own trace/debug chatter and keeps ours.
type stderrLogger struct {
	prefix string
	quiet  bool
}

func (l *stderrLogger) logf(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "shim: "+l.prefix+format+"\n", args...)
}
func (l *stderrLogger) log(args ...interface{}) {
	fmt.Fprint(os.Stderr, "shim: "+l.prefix)
	fmt.Fprintln(os.Stderr, args...)
}
func (l *stderrLogger) quietf(format string, args ...interface{}) {
	if !l.quiet {
		l.logf(format, args...)
	}
}
func (l *stderrLogger) quietln(args ...interface{}) {
	if !l.quiet {
		l.log(args...)
	}
}

func (l *stderrLogger) Tracef(format string, args ...interface{}) { l.quietf(format, args...) }
func (l *stderrLogger) Debugf(format string, args ...interface{}) { l.quietf(format, args...) }
func (l *stderrLogger) Infof(format string, args ...interface{})  { l.logf(format, args...) }
func (l *stderrLogger) Warnf(format string, args ...interface{})  { l.logf(format, args...) }
func (l *stderrLogger) Errorf(format string, args ...interface{}) { l.logf(format, args...) }
func (l *stderrLogger) Trace(args ...interface{})                 { l.quietln(args...) }
func (l *stderrLogger) Debug(args ...interface{})                 { l.quietln(args...) }
func (l *stderrLogger) Info(args ...interface{})                  { l.log(args...) }
func (l *stderrLogger) Warn(args ...interface{})                  { l.log(args...) }
func (l *stderrLogger) Error(args ...interface{})                 { l.log(args...) }

func (l *stderrLogger) WithField(key string, value interface{}) librespot.Logger {
	return &stderrLogger{prefix: fmt.Sprintf("%s%s=%v ", l.prefix, key, value), quiet: l.quiet}
}
func (l *stderrLogger) WithError(err error) librespot.Logger {
	return &stderrLogger{prefix: fmt.Sprintf("%serror=%v ", l.prefix, err), quiet: l.quiet}
}
