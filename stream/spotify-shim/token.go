package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ── URL signing ──────────────────────────────────────────────────────────────
// Tokens are `<expiry-unix>.<base64url(hmac-sha256)>` over the track id and that expiry.
//
// Signed rather than one-time: the app and the shim are separate processes, so a per-item random
// token (what the rundown mints for a rendered segment) would need shared state between them. An
// HMAC needs only the secret both already hold, and the expiry keeps a URL that leaked into a log
// from being replayable for long.
const tokenTTL = 30 * time.Minute

func signToken(secret, trackId string, expiry time.Time) string {
	exp := strconv.FormatInt(expiry.Unix(), 10)
	return exp + "." + base64.RawURLEncoding.EncodeToString(tokenMac(secret, trackId, exp))
}

func verifyToken(secret, trackId, token string, now time.Time) error {
	if secret == "" {
		// Refuse rather than serve: an unset secret would otherwise make every fetch public.
		return fmt.Errorf("no signing secret configured")
	}
	exp, mac, found := strings.Cut(token, ".")
	if !found {
		return fmt.Errorf("malformed token")
	}
	sent, err := base64.RawURLEncoding.DecodeString(mac)
	if err != nil {
		return fmt.Errorf("malformed token signature")
	}
	// Compare before reading the expiry: an unsigned token's claims are not worth parsing.
	if !hmac.Equal(sent, tokenMac(secret, trackId, exp)) {
		return fmt.Errorf("bad token signature")
	}
	seconds, err := strconv.ParseInt(exp, 10, 64)
	if err != nil {
		return fmt.Errorf("malformed token expiry")
	}
	if now.After(time.Unix(seconds, 0)) {
		return fmt.Errorf("token expired")
	}
	return nil
}

func tokenMac(secret, trackId, exp string) []byte {
	m := hmac.New(sha256.New, []byte(secret))
	// Length-prefixed so no pair of (id, exp) can be rearranged into the same input as another.
	fmt.Fprintf(m, "%d:%s:%d:%s", len(trackId), trackId, len(exp), exp)
	return m.Sum(nil)
}
