package main

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	librespot "github.com/devgianlu/go-librespot"
	connectpb "github.com/devgianlu/go-librespot/proto/spotify/connectstate"
	extmetadatapb "github.com/devgianlu/go-librespot/proto/spotify/extendedmetadata"
	metadatapb "github.com/devgianlu/go-librespot/proto/spotify/metadata"
	"github.com/devgianlu/go-librespot/spclient"
)

// Reading what a playlist HOLDS, through the same client session that fetches audio.
//
// **This is a spike, and it is one-shot only.** Nothing here is reachable over HTTP and nothing in
// the station calls it. It exists to answer one question before anything is built on it: does
// context-resolve answer for the playlists the Web API refuses, on this account, with this login?
//
// ## Why it can work at all
//
// Since February 2026 the Web API only returns a playlist's items to the account that OWNS it, so
// `GET /playlists/{id}/items` answers 403 for an editorial list, for Discover Weekly, and for a
// playlist a friend made — which is most of what `GET /me/playlists` returns, because that endpoint
// lists what the account FOLLOWS. Those rules are written for a developer app in development mode.
// This process is not one: it holds the streaming client's own session (see connect()), and
// `/context-resolve/v1/{uri}` is the call a Connect device makes when somebody presses play on a
// playlist. So the traffic here is the client's ordinary traffic rather than a way around a rule.
//
// ## What it costs, which is the thing to weigh after reading the output
//
// The response is Spotify's internal shape, not a documented one, and this session is the SAME one
// the station fetches audio on. Rate limiting or a protocol change lands on playout, not just on a
// listing, so a playlist read that is merely nice to have is spending the station's voice. Read the
// timings this prints with that in mind.
//
// ## The two calls
//
// `ContextResolve` answers URIs and nothing else: a page of `{uri, uid, metadata}`, paged through
// `hm://` page urls, which the resolver follows. The titles then come from one batched
// `ExtendedMetadata` request per chunk — the same `TRACK_V4` read `openTrack` already makes per
// track, asked for many at once.

// How many track URIs go into one extended-metadata request. Not measured, and one of the things
// the spike is for: the aim is a few round trips for a long playlist rather than one per track.
const metadataBatchSize = 100

// Pages of context to walk before giving up on a provider that does not advance. A playlist page is
// 100-ish tracks, so this is a ceiling on a runaway rather than a limit anybody should hit.
const maxContextPages = 200

// One track of a playlist, in roughly the shape `ProviderTrack` wants, so the output can be read as
// "could the plugin answer `getPlaylistTracks` from this?" rather than as a protocol dump.
type playlistTrack struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Artists    []string `json:"artists,omitempty"`
	Album      string   `json:"album,omitempty"`
	DurationMs int32    `json:"durationMs,omitempty"`
	ISRC       string   `json:"isrc,omitempty"`
	Year       int32    `json:"year,omitempty"`
	Popularity int32    `json:"popularity,omitempty"`
	Advisory   string   `json:"advisory,omitempty"`
	ArtworkURL string   `json:"artworkUrl,omitempty"`
	// Whether this account could actually be served the audio, by the same test `openTrack` makes.
	// A playlist that resolves and then cannot play is a different answer from one that resolves.
	Playable bool `json:"playable"`
	// Set when the metadata read failed for this URI, which is the interesting case: the context
	// resolved and the titles did not.
	Error string `json:"error,omitempty"`
}

// What one spike run learned about one playlist.
type playlistAnswer struct {
	URI string `json:"uri"`
	// Whatever the context carries about itself. Undocumented and worth printing verbatim: this is
	// where a name would have to come from, and the spike is how we find out whether one is there.
	Metadata map[string]string `json:"metadata,omitempty"`
	Pages    int               `json:"pages"`
	Total    int               `json:"total"`
	// How long each half took. The resolve is one request per page; the metadata is one per batch.
	ResolveMs  int64           `json:"resolveMs"`
	MetadataMs int64           `json:"metadataMs"`
	Tracks     []playlistTrack `json:"tracks"`
}

// Resolve a playlist's tracks: URIs from the context resolver, then titles in batches.
//
// `limit` caps how many tracks are described, so a 2000-track playlist can be probed without
// waiting for all of it. Zero means everything the context has.
func (s *session) resolvePlaylist(ctx context.Context, log librespot.Logger, uri string, limit int) (*playlistAnswer, error) {
	id, err := parsePlaylistId(uri)
	if err != nil {
		return nil, err
	}

	started := time.Now()
	resolver, err := spclient.NewContextResolver(ctx, log, s.sp, &connectpb.Context{Uri: id.Uri()})
	if err != nil {
		return nil, fmt.Errorf("failed resolving the playlist context: %w", err)
	}

	answer := &playlistAnswer{URI: id.Uri(), Metadata: resolver.Metadata()}
	var uris []string
	for page := 0; page < maxContextPages; page++ {
		tracks, err := resolver.Page(ctx, page)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed reading context page %d: %w", page, err)
		}

		answer.Pages++
		for _, track := range tracks {
			if track.GetUri() == "" {
				// A local file, or an episode the context carries by gid only. Nothing here can
				// fetch one, and a row with no uri cannot be asked about.
				continue
			}
			uris = append(uris, track.GetUri())
			if limit > 0 && len(uris) >= limit {
				break
			}
		}
		if limit > 0 && len(uris) >= limit {
			break
		}
	}
	answer.ResolveMs = time.Since(started).Milliseconds()
	answer.Total = len(uris)

	started = time.Now()
	for start := 0; start < len(uris); start += metadataBatchSize {
		end := min(start+metadataBatchSize, len(uris))
		batch, err := s.describeTracks(ctx, uris[start:end])
		if err != nil {
			return nil, err
		}
		answer.Tracks = append(answer.Tracks, batch...)
	}
	answer.MetadataMs = time.Since(started).Milliseconds()
	return answer, nil
}

// One extended-metadata request for many track URIs.
//
// The per-entity status is read rather than the response as a whole: one track the account cannot
// see must not cost the other ninety-nine their titles, and a row that comes back empty is the
// answer to "what happens to a playlist holding something this account has no rights to".
func (s *session) describeTracks(ctx context.Context, uris []string) ([]playlistTrack, error) {
	requests := make([]*extmetadatapb.EntityRequest, 0, len(uris))
	for _, uri := range uris {
		requests = append(requests, &extmetadatapb.EntityRequest{
			EntityUri: uri,
			Query:     []*extmetadatapb.ExtensionQuery{{ExtensionKind: extmetadatapb.ExtensionKind_TRACK_V4}},
		})
	}

	response, err := s.sp.ExtendedMetadata(ctx, &extmetadatapb.BatchedEntityRequest{EntityRequest: requests})
	if err != nil {
		return nil, fmt.Errorf("failed reading metadata for %d tracks: %w", len(uris), err)
	}

	// Keyed by uri, because the response is not promised in the order it was asked in.
	described := make(map[string]playlistTrack, len(uris))
	for _, extension := range response.GetExtendedMetadata() {
		if extension.GetExtensionKind() != extmetadatapb.ExtensionKind_TRACK_V4 {
			continue
		}
		for _, data := range extension.GetExtensionData() {
			uri := data.GetEntityUri()
			if status := data.GetHeader().GetStatusCode(); status != 200 {
				described[uri] = playlistTrack{ID: idOf(uri), Error: fmt.Sprintf("metadata status %d", status)}
				continue
			}
			var track metadatapb.Track
			if err := data.GetExtensionData().UnmarshalTo(&track); err != nil {
				described[uri] = playlistTrack{ID: idOf(uri), Error: fmt.Sprintf("unreadable metadata: %v", err)}
				continue
			}
			described[uri] = s.describe(uri, &track)
		}
	}

	// In the order the playlist holds them, with anything the response omitted still named.
	out := make([]playlistTrack, 0, len(uris))
	for _, uri := range uris {
		if track, ok := described[uri]; ok {
			out = append(out, track)
			continue
		}
		out = append(out, playlistTrack{ID: idOf(uri), Error: "no metadata in the response"})
	}
	return out, nil
}

func (s *session) describe(uri string, track *metadatapb.Track) playlistTrack {
	described := playlistTrack{
		ID:         idOf(uri),
		Title:      track.GetName(),
		Album:      track.GetAlbum().GetName(),
		DurationMs: track.GetDuration(),
		Popularity: track.GetPopularity(),
		Year:       track.GetAlbum().GetDate().GetYear(),
	}
	for _, artist := range track.GetArtist() {
		if artist.GetName() != "" {
			described.Artists = append(described.Artists, artist.GetName())
		}
	}
	for _, external := range track.GetExternalId() {
		if external.GetType() == "isrc" {
			described.ISRC = external.GetId()
			break
		}
	}
	if track.Explicit != nil {
		described.Advisory = "clean"
		if track.GetExplicit() {
			described.Advisory = "explicit"
		}
	}
	if images := track.GetAlbum().GetCoverGroup().GetImage(); len(images) > 0 {
		described.ArtworkURL = "https://i.scdn.co/image/" + hex.EncodeToString(images[0].GetFileId())
	}
	// The same test the fetch makes, relinking included, so this says "the station could play it"
	// rather than "Spotify described it".
	if _, err := s.playableMedia(track); err == nil {
		described.Playable = true
	}
	return described
}

// The base62 id out of a `spotify:track:...` uri, for output that reads like the Web API's ids.
// Anything unparseable is reported whole rather than dropped: in a spike the odd shape IS the
// finding.
func idOf(uri string) string {
	id, err := librespot.SpotifyIdFromUri(uri)
	if err != nil {
		return uri
	}
	return id.Base62()
}

func parsePlaylistId(uri string) (*librespot.SpotifyId, error) {
	if len(uri) > 0 && uri[0] != 's' {
		uri = "spotify:playlist:" + uri
	}
	id, err := librespot.SpotifyIdFromUri(uri)
	if err != nil {
		return nil, fmt.Errorf("invalid playlist uri %q: %w", uri, err)
	}
	if id.Type() != librespot.SpotifyIdTypePlaylist {
		return nil, fmt.Errorf("%q is a %s, not a playlist", uri, id.Type())
	}
	return id, nil
}
