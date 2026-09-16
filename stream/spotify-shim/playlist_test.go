package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Serving a playlist, and specifically the two things a caller pages on: that a page is a window
// onto ONE resolve, and that a short page means the end of the playlist rather than a row somebody
// filtered out on the way past.
//
// Every server here carries a nil session holder, the same trick the track tests use: anything that
// reaches for Spotify panics, so "was this answered from the cache?" is something a test can assert
// rather than infer.

func resolved(total int) *playlistAnswer {
	answer := &playlistAnswer{URI: "spotify:playlist:6Xc2jJXo4XJUfay3AkdXy3", Name: "Techno/Coding", Owner: "somebody-else"}
	for i := range total {
		answer.Tracks = append(answer.Tracks, playlistTrack{
			ID:       fmt.Sprintf("track-%d", i),
			Title:    fmt.Sprintf("Track %d", i),
			Artists:  []string{"An Artist"},
			Playable: i%50 != 7, // a scattering of unplayable rows, which must NOT be filtered out
		})
	}
	answer.Total = len(answer.Tracks)
	return answer
}

// A server that can only answer from its cache. `sessions: nil` is the assertion: a miss panics.
func cachedServer(answer *playlistAnswer) *server {
	cache := newPlaylistCache()
	if answer != nil {
		cache.put(answer.URI, answer)
	}
	return &server{
		log:          &librespot.NullLogger{},
		secret:       secret,
		shimSecret:   shimSecret,
		playlists:    cache,
		sessions:     nil,
		fetchTimeout: time.Second,
	}
}

func playlistRequest(target, secretHeader string) *http.Request {
	req := httptest.NewRequest("GET", target, nil)
	req.Header.Set("X-Spotify-Login-Secret", secretHeader)
	return req
}

func readPage(t *testing.T, rec *httptest.ResponseRecorder) playlistPage {
	t.Helper()
	var page playlistPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatalf("unreadable answer %q: %v", rec.Body.String(), err)
	}
	return page
}

// The read is of this account's library, so it sits behind the secret that decides whose account
// this shim fetches as — not behind the HMAC, which exists only because Liquidsoap sends no headers.
func TestPlaylistReadRequiresTheLoginSecret(t *testing.T) {
	rec := httptest.NewRecorder()
	cachedServer(resolved(3)).routes().ServeHTTP(rec, playlistRequest("/playlist/6Xc2jJXo4XJUfay3AkdXy3", "wrong"))

	if rec.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("answered %d, want 401", rec.Result().StatusCode)
	}
}

// Nothing could match, so the route cannot serve anybody: that is not a refusal of this caller.
func TestPlaylistReadIsDisabledWithoutASecret(t *testing.T) {
	srv := cachedServer(resolved(3))
	srv.shimSecret = ""

	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, playlistRequest("/playlist/6Xc2jJXo4XJUfay3AkdXy3", ""))

	if rec.Result().StatusCode != http.StatusNotFound {
		t.Fatalf("answered %d, want 404", rec.Result().StatusCode)
	}
}

func TestPlaylistReadRefusesWhatItCannotPage(t *testing.T) {
	// A BARE base62 id is not in here, and cannot be: a track id and a playlist id are the same
	// shape, so the shim reads a bare one as the playlist it was asked for and lets Spotify be the
	// one to say otherwise. Only a uri that spells out a different type is refusable here.
	for name, target := range map[string]string{
		"a track uri":        "/playlist/spotify:track:4PTG3Z6ehGkBFwjybzWkR8",
		"a negative offset":  "/playlist/6Xc2jJXo4XJUfay3AkdXy3?offset=-1",
		"a garbled offset":   "/playlist/6Xc2jJXo4XJUfay3AkdXy3?offset=soon",
		"an oversized limit": "/playlist/6Xc2jJXo4XJUfay3AkdXy3?limit=5000",
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			cachedServer(resolved(3)).routes().ServeHTTP(rec, playlistRequest(target, shimSecret))

			if rec.Result().StatusCode != http.StatusBadRequest {
				t.Fatalf("answered %d, want 400", rec.Result().StatusCode)
			}
		})
	}
}

// The whole point of the cache: a caller walking a long playlist resolves it once. A miss here
// would panic on the nil session holder.
func TestAPageIsAWindowOntoOneResolve(t *testing.T) {
	srv := cachedServer(resolved(2142))

	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, playlistRequest("/playlist/6Xc2jJXo4XJUfay3AkdXy3?offset=2100&limit=50", shimSecret))

	page := readPage(t, rec)
	if page.Total != 2142 {
		t.Fatalf("total %d, want the whole playlist (2142) rather than the page", page.Total)
	}
	if len(page.Tracks) != 42 {
		t.Fatalf("got %d tracks, want the 42 left after offset 2100", len(page.Tracks))
	}
	if page.Tracks[0].ID != "track-2100" {
		t.Fatalf("page starts at %q, want track-2100", page.Tracks[0].ID)
	}
	if page.Name != "Techno/Coding" || page.Owner != "somebody-else" {
		t.Fatalf("page says %q by %q, want the context's own name and owner", page.Name, page.Owner)
	}
	if page.ID != "6Xc2jJXo4XJUfay3AkdXy3" {
		t.Fatalf("page id %q, want the base62 id rather than the uri", page.ID)
	}
}

// A caller pages until it gets a short page. If a row it cannot play were dropped here, a walk
// would stop wherever the first one happened to fall.
func TestAPageKeepsTheTracksThisAccountCannotPlay(t *testing.T) {
	srv := cachedServer(resolved(50))

	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, playlistRequest("/playlist/6Xc2jJXo4XJUfay3AkdXy3?limit=50", shimSecret))

	page := readPage(t, rec)
	if len(page.Tracks) != 50 {
		t.Fatalf("got %d tracks, want a full page of 50 with the unplayable ones still in it", len(page.Tracks))
	}
	if page.Tracks[7].Playable {
		t.Fatal("the unplayable row was filtered out, which would end a caller's walk early")
	}
}

// Past the end is an empty page rather than an error: a caller that asked for one more page than
// the playlist has is how it learns there are no more.
func TestAPagePastTheEndIsEmptyRatherThanMissing(t *testing.T) {
	srv := cachedServer(resolved(10))

	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, playlistRequest("/playlist/6Xc2jJXo4XJUfay3AkdXy3?offset=100", shimSecret))

	if rec.Result().StatusCode != http.StatusOK {
		t.Fatalf("answered %d, want 200", rec.Result().StatusCode)
	}
	// `[]` and not `null`: a caller should not have to special-case the shape of "no more".
	if body := rec.Body.String(); !strings.Contains(body, `"tracks":[]`) {
		t.Fatalf("answered %q, want an empty tracks array", body)
	}
}

// The default page size matches the host's own, so a caller that says nothing gets what the app's
// plugin paging asks for.
func TestAPageDefaultsToTheHostsPageSize(t *testing.T) {
	srv := cachedServer(resolved(120))

	rec := httptest.NewRecorder()
	srv.routes().ServeHTTP(rec, playlistRequest("/playlist/6Xc2jJXo4XJUfay3AkdXy3", shimSecret))

	if page := readPage(t, rec); len(page.Tracks) != defaultPlaylistPageSize {
		t.Fatalf("got %d tracks, want the default %d", len(page.Tracks), defaultPlaylistPageSize)
	}
}

func TestACachedResolveIsForgottenOnceItIsStale(t *testing.T) {
	cache := newPlaylistCache()
	now := time.Now()
	cache.now = func() time.Time { return now }
	answer := resolved(3)
	cache.put(answer.URI, answer)

	if cache.get(answer.URI) == nil {
		t.Fatal("a fresh resolve was not kept")
	}

	now = now.Add(playlistCacheTTL + time.Second)
	if cache.get(answer.URI) != nil {
		t.Fatal("a stale resolve was served; a playlist changes and this is the only place one is remembered")
	}
}

// A bound on a mistake rather than a working set: each entry is a described playlist, and a long
// one is a megabyte of it.
func TestTheCacheDropsTheOldestResolveWhenItIsFull(t *testing.T) {
	cache := newPlaylistCache()
	now := time.Now()
	cache.now = func() time.Time { return now }

	for i := range playlistCacheEntries {
		cache.put(fmt.Sprintf("spotify:playlist:p%d", i), resolved(1))
		now = now.Add(time.Second)
	}
	cache.put("spotify:playlist:newcomer", resolved(1))

	if cache.get("spotify:playlist:p0") != nil {
		t.Fatal("the oldest resolve survived a full cache")
	}
	if cache.get("spotify:playlist:newcomer") == nil {
		t.Fatal("the newest resolve was not kept")
	}
	if cache.get("spotify:playlist:p1") == nil {
		t.Fatal("more than the oldest was evicted")
	}
}

func TestOnlyAPlaylistIdIsAPlaylistId(t *testing.T) {
	if _, err := parsePlaylistId("6Xc2jJXo4XJUfay3AkdXy3"); err != nil {
		t.Fatalf("a bare base62 id was refused: %v", err)
	}
	if _, err := parsePlaylistId("spotify:playlist:6Xc2jJXo4XJUfay3AkdXy3"); err != nil {
		t.Fatalf("a full uri was refused: %v", err)
	}
	if _, err := parsePlaylistId("spotify:track:4PTG3Z6ehGkBFwjybzWkR8"); err == nil {
		t.Fatal("a track uri was accepted as a playlist")
	}
}
