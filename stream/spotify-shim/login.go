package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	librespot "github.com/devgianlu/go-librespot"
)

// How the accesspoint is authenticated, and where that comes from.
//
// There are two forms, and which one is used decides whether the login5 exchange behind it can
// succeed at all. They are not interchangeable, which is the whole reason this type exists rather
// than a bare (username, token) pair.

// One way to authenticate the accesspoint. Exactly one of `stored` and `token` is set.
//
// **`stored` is the real one.** It is the blob the accesspoint hands back after an authorization
// (see authorize.go), and it belongs to the same client the client token is minted for — so login5,
// which validates the accesspoint's stored credentials against that client, agrees with it.
//
// `token` is an access token minted by the OPERATOR'S OWN Spotify app, pushed over by the app as it
// resolves a track. The accesspoint accepts it, and login5 then refuses the pairing, because the
// two halves belong to different clients. It is kept as the fallback for a shim that has never been
// authorized, and for one-shot debugging, and it should not be relied on: measured on 2026-08-10, a
// station on this path authenticates the accesspoint and is refused by login5 on every track.
type login struct {
	username string
	stored   []byte
	token    string
}

// Whether this login carries the stored form, which is the one login5 accepts.
func (l login) isStored() bool { return len(l.stored) > 0 }

// The authorization this shim did for itself, kept on disk so it survives a restart.
//
// One file, holding the account name and the accesspoint's reusable credential blob. It is written
// once, by a completed authorization, and read on every login after that: the interactive step an
// operator does in a browser happens exactly once per station rather than once per container.
//
// Reads go to the file each time rather than to a cache. It is a few hundred bytes on a local
// volume, a login attempt is several network round trips, and reading it fresh means an operator
// who drops a file in by hand (restoring a backup, moving a station between hosts) is picked up
// without a restart.
type storedLogin struct {
	// Serializes the read-modify-write of the file, not the file's contents: two authorizations
	// completing at once would otherwise interleave a write with a rename.
	mu   sync.Mutex
	path string
	// What answers when there is no stored authorization yet. The pushed login, in the container.
	next credentialSource
	log  librespot.Logger
	// So an unreadable file is reported once rather than on every login attempt.
	complained bool
}

// The on-disk shape. `credentials` is base64 in the JSON, which is what encoding/json does with a
// []byte and is the right thing here: the blob is binary and the file wants to stay readable enough
// to diff and to eyeball.
type storedLoginFile struct {
	Username    string `json:"username"`
	Credentials []byte `json:"credentials"`
}

func (s *storedLogin) fetch(ctx context.Context, client *http.Client) (login, error) {
	if stored, ok := s.read(); ok {
		return stored, nil
	}
	return s.next.fetch(ctx, client)
}

// The stored authorization, or `false` when there is not one.
//
// A missing file is the ordinary state of a station nobody has authorized yet, so it falls through
// silently. A file that IS there and cannot be read is different — somebody meant for this to work —
// so it is reported, once, and then falls through: refusing to log in at all would turn a corrupt
// file into a station that cannot play, where falling through leaves it exactly as it was before
// anyone authorized.
func (s *storedLogin) read() (login, bool) {
	if s.path == "" {
		return login{}, false
	}

	raw, err := os.ReadFile(s.path)
	if err != nil {
		if !os.IsNotExist(err) {
			s.complain("could not read the stored Spotify login at %s: %v", s.path, err)
		}
		return login{}, false
	}

	var file storedLoginFile
	if err := json.Unmarshal(raw, &file); err != nil {
		s.complain("the stored Spotify login at %s is not readable JSON (%v); authorize again to replace it", s.path, err)
		return login{}, false
	}
	if file.Username == "" || len(file.Credentials) == 0 {
		s.complain("the stored Spotify login at %s carries no username/credentials; authorize again to replace it", s.path)
		return login{}, false
	}
	return login{username: file.Username, stored: file.Credentials}, true
}

// Say something about the stored file once, not once per login attempt. The backoff in the session
// holder means a broken station tries every 60s forever, and a line per attempt buries the report.
func (s *storedLogin) complain(format string, args ...any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.complained || s.log == nil {
		return
	}
	s.complained = true
	s.log.Warnf(format, args...)
}

// Whether a stored authorization exists, for the health probe. Never a reason to attempt a login.
//
// Nil-tolerant so a `server` assembled without a store (which is every unit test of the track
// routes) can still answer a health probe rather than panicking on a field it has no opinion about.
func (s *storedLogin) present() bool {
	if s == nil {
		return false
	}
	_, ok := s.read()
	return ok
}

// Record a completed authorization.
//
// Written through a temp file and renamed, because the alternative is a truncated file: a shim
// killed mid-write would otherwise come back to a credential it cannot parse, and the operator
// would have to notice that and authorize again. 0600 because this blob IS the account — anything
// holding it can fetch that library's audio.
func (s *storedLogin) save(username string, credentials []byte) error {
	if s.path == "" {
		return fmt.Errorf("no credentials path is configured, so this authorization cannot be kept")
	}
	if username == "" || len(credentials) == 0 {
		return fmt.Errorf("refusing to store an incomplete login for %q", username)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("failed preparing %s: %w", filepath.Dir(s.path), err)
	}

	body, err := json.MarshalIndent(storedLoginFile{Username: username, Credentials: credentials}, "", "  ")
	if err != nil {
		return fmt.Errorf("failed encoding the login: %w", err)
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return fmt.Errorf("failed writing %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("failed installing %s: %w", s.path, err)
	}
	// A fresh file earns a fresh complaint if it ever goes bad, so a station authorized twice does
	// not stay silent about the second file because the first one was reported.
	s.complained = false
	return nil
}
