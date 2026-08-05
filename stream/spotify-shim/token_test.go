package main

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

// Track URLs are signed because Liquidsoap fetches a queued item with no headers from us, so the
// authorization has to survive in a query string. These are the checks that keep that from being
// decorative.

const secret = "s3cr3t"

var now = time.Unix(1_700_000_000, 0)

func TestVerifyTokenAcceptsWhatItSigned(t *testing.T) {
	tok := signToken(secret, "4PTG3Z6ehGkBFwjybzWkR8", now.Add(time.Hour))
	if err := verifyToken(secret, "4PTG3Z6ehGkBFwjybzWkR8", tok, now); err != nil {
		t.Fatalf("rejected its own token: %v", err)
	}
}

func TestVerifyTokenRejectsAnotherTrack(t *testing.T) {
	// The signature covers the id, so a URL for one track cannot be pointed at another.
	tok := signToken(secret, "trackA", now.Add(time.Hour))
	if err := verifyToken(secret, "trackB", tok, now); err == nil {
		t.Fatal("accepted a token minted for a different track")
	}
}

func TestVerifyTokenRejectsAnotherSecret(t *testing.T) {
	tok := signToken("other-secret", "trackA", now.Add(time.Hour))
	if err := verifyToken(secret, "trackA", tok, now); err == nil {
		t.Fatal("accepted a token signed with a different secret")
	}
}

func TestVerifyTokenRejectsAnExpiredToken(t *testing.T) {
	tok := signToken(secret, "trackA", now.Add(time.Minute))
	if err := verifyToken(secret, "trackA", tok, now.Add(2*time.Minute)); err == nil {
		t.Fatal("accepted an expired token")
	}
}

// The expiry travels in the clear, so it has to be signed too: without that, anyone holding an
// expired URL could edit its expiry and keep using it.
func TestVerifyTokenRejectsAnExtendedExpiry(t *testing.T) {
	tok := signToken(secret, "trackA", now.Add(time.Minute))
	_, mac, _ := strings.Cut(tok, ".")
	forged := "99999999999." + mac
	if err := verifyToken(secret, "trackA", forged, now); err == nil {
		t.Fatal("accepted a token whose expiry was rewritten")
	}
}

func TestVerifyTokenRejectsMalformedAndMissingTokens(t *testing.T) {
	for _, tok := range []string{"", ".", "nodot", "123.not-base64!!", "123."} {
		if err := verifyToken(secret, "trackA", tok, now); err == nil {
			t.Fatalf("accepted malformed token %q", tok)
		}
	}
}

// An unset secret must refuse every fetch rather than wave them all through. serve() also refuses
// to start without one; this is the second line of that.
func TestVerifyTokenRefusesWhenNoSecretIsConfigured(t *testing.T) {
	if err := verifyToken("", "trackA", signToken("", "trackA", now.Add(time.Hour)), now); err == nil {
		t.Fatal("verified a token with no configured secret")
	}
}

// The id and the expiry are length-prefixed into the MAC, so no split of one concatenation can be
// re-cut into another that signs the same bytes.
func TestTokenMacIsUnambiguousAcrossFieldBoundaries(t *testing.T) {
	if bytes.Equal(tokenMac(secret, "ab", "1234"), tokenMac(secret, "ab1", "234")) {
		t.Fatal("two different (id, expiry) pairs produced the same mac")
	}
}

// The app mints these tokens in TypeScript (SpotifyTrackResolver.signTrackToken). Both sides pin
// THIS vector, so changing the wire format on one without the other fails a suite rather than
// silently 401ing every fetch on air.
func TestTokenMatchesTheAppsWireFormat(t *testing.T) {
	const (
		trackId  = "4PTG3Z6ehGkBFwjybzWkR8"
		expiry   = 1785247352
		expected = "1785247352.6rV-wqRLfayJubNy9JWlD_tFoTyQXZHcvP7T_ewGdcg"
	)
	if got := signToken(secret, trackId, time.Unix(expiry, 0)); got != expected {
		t.Fatalf("signed %q, want %q", got, expected)
	}
	// And the verifier accepts what the app would have sent.
	if err := verifyToken(secret, trackId, expected, time.Unix(expiry-60, 0)); err != nil {
		t.Fatalf("rejected the app's token: %v", err)
	}
}
