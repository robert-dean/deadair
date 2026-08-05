package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"

	librespot "github.com/devgianlu/go-librespot"
	"github.com/devgianlu/go-librespot/audio"
	downloadpb "github.com/devgianlu/go-librespot/proto/spotify/download"
	extmetadatapb "github.com/devgianlu/go-librespot/proto/spotify/extendedmetadata"
	audiofilespb "github.com/devgianlu/go-librespot/proto/spotify/extendedmetadata/audiofiles"
	metadatapb "github.com/devgianlu/go-librespot/proto/spotify/metadata"
)

// Turning one track id into bytes: metadata, audio key, storage resolve, CDN read, decrypt.
// This is the same sequence player.NewStream runs, minus everything about playing it.

// A track ready to hand out: an Ogg Vorbis bitstream, seekable so the HTTP layer can answer
// Range requests and report a length without buffering the whole thing.
type trackStream struct {
	io.ReadSeeker
	// Closing releases the CDN reader underneath, which runs prefetch goroutines and holds
	// connections. Every caller MUST close: in a long-lived server, leaking one of these per fetch
	// is a leak per track aired.
	closer  io.Closer
	name    string
	artist  string
	size    int64
	format  string
	bitrate int
}

func (t *trackStream) Close() error {
	return t.closer.Close()
}

// Resolve a track to a decrypted Ogg Vorbis stream.
func (s *session) openTrack(ctx context.Context, client *http.Client, log librespot.Logger, uri string, preferredBitrate int) (*trackStream, error) {
	spotId, err := parseTrackId(uri)
	if err != nil {
		return nil, err
	}

	var trackMeta metadatapb.Track
	if err := s.sp.ExtendedMetadataSimple(ctx, *spotId, extmetadatapb.ExtensionKind_TRACK_V4, &trackMeta); err != nil {
		return nil, fmt.Errorf("failed getting track metadata: %w", err)
	}
	media, err := s.playableMedia(&trackMeta)
	if err != nil {
		return nil, err
	}

	file, kbps, err := s.selectOggFile(ctx, media, &trackMeta, preferredBitrate)
	if err != nil {
		return nil, err
	}
	log.Debugf("selected %s (%x) for %q", file.Format.String(), file.FileId, trackMeta.GetName())

	key, err := s.keys.Request(ctx, media.Id().Id(), file.FileId)
	if err != nil {
		return nil, fmt.Errorf("failed retrieving audio key: %w", err)
	}

	storage, err := s.sp.ResolveStorageInteractive(ctx, file.FileId, file.Format, false)
	if err != nil {
		return nil, fmt.Errorf("failed resolving track storage: %w", err)
	}
	cdnUrl, err := firstCdnUrl(storage)
	if err != nil {
		return nil, err
	}

	raw, err := audio.NewHttpChunkedReader(log, client, cdnUrl)
	if err != nil {
		return nil, fmt.Errorf("failed creating chunked reader: %w", err)
	}
	decrypted, err := audio.NewAesAudioDecryptor(raw, key)
	if err != nil {
		// Every failure past this point has to release the reader, or a track that cannot be
		// served still costs us its prefetch goroutines and connections.
		_ = raw.Close()
		return nil, fmt.Errorf("failed initializing audio decryptor: %w", err)
	}
	ogg, err := trimMetadataPage(decrypted, raw.Size())
	if err != nil {
		_ = decrypted.Close()
		return nil, err
	}

	return &trackStream{
		ReadSeeker: ogg,
		// Decryptor.Close delegates to the CDN reader's, which cancels its prefetch and waits.
		closer:  decrypted,
		name:    trackMeta.GetName(),
		artist:  firstArtist(&trackMeta),
		size:    ogg.Size(),
		format:  file.Format.String(),
		bitrate: kbps,
	}, nil
}

// The version of this track that can actually be played, following Spotify's relinking when the
// one we asked for is not available in this account's market. The alternative carries its own gid
// and file list, which is why the caller has to take the returned media rather than the id it
// started with.
//
// We pick by whether a candidate HAS files rather than by comparing the market against the
// restriction list: the account's country is known to the accesspoint but not exposed to us, and
// an unplayable candidate reliably comes back with nothing to play.
func (s *session) playableMedia(trackMeta *metadatapb.Track) (*librespot.Media, error) {
	if len(trackMeta.File) > 0 {
		return librespot.NewMediaFromTrack(trackMeta), nil
	}
	for _, alt := range trackMeta.Alternative {
		if len(alt.File) == 0 {
			continue
		}
		// Graft the alternative onto the track, the way player.getUnrestrictedTrack does: the rest
		// of the metadata (name, artists) is only on the original.
		trackMeta.Gid, trackMeta.File = alt.Gid, alt.File
		trackMeta.Alternative = nil
		return librespot.NewMediaFromTrack(trackMeta), nil
	}
	// No files anywhere is what an unavailable track looks like: region-locked with no relink, or
	// pulled from the catalogue. Say so plainly, since the alternative is a decode failure on air.
	return nil, fmt.Errorf("%q is not playable by this account (no audio files on the track or any of its %d alternative(s))", trackMeta.GetName(), len(trackMeta.Alternative))
}

// The Ogg file for this track at the closest available bitrate, and that bitrate. Prefers the
// AUDIO_FILES extension (what the player uses, and the only place some tracks list their files)
// and falls back to the file list on the track itself. FLAC is never considered: it needs the
// PlayPlay plugin this build does not have.
func (s *session) selectOggFile(ctx context.Context, media *librespot.Media, trackMeta *metadatapb.Track, preferred int) (*metadatapb.AudioFile, int, error) {
	files := trackMeta.File

	var resp audiofilespb.AudioFilesExtensionResponse
	if err := s.sp.ExtendedMetadataSimple(ctx, media.Id(), extmetadatapb.ExtensionKind_AUDIO_FILES, &resp); err == nil && len(resp.Files) > 0 {
		files = nil
		for _, f := range resp.Files {
			files = append(files, f.File)
		}
	}

	var best *metadatapb.AudioFile
	bestKbps, bestDist := 0, 0
	for _, f := range files {
		kbps, ok := oggBitrate(f.GetFormat())
		if !ok {
			continue
		}
		dist := kbps - preferred
		if dist < 0 {
			dist = -dist
		}
		if best == nil || dist < bestDist {
			best, bestKbps, bestDist = f, kbps, dist
		}
	}
	if best == nil {
		return nil, 0, fmt.Errorf("no Ogg Vorbis file for this track (%d candidate file(s))", len(files))
	}
	return best, bestKbps, nil
}

// kbps of an Ogg Vorbis format, and whether the format is one at all.
func oggBitrate(format metadatapb.AudioFile_Format) (int, bool) {
	switch format {
	case metadatapb.AudioFile_OGG_VORBIS_96:
		return 96, true
	case metadatapb.AudioFile_OGG_VORBIS_160:
		return 160, true
	case metadatapb.AudioFile_OGG_VORBIS_320:
		return 320, true
	default:
		return 0, false
	}
}

func firstCdnUrl(storage *downloadpb.StorageResolveResponse) (string, error) {
	if storage.Result != downloadpb.StorageResolveResponse_CDN {
		return "", fmt.Errorf("storage resolve returned %s, not CDN", storage.Result)
	}
	for _, raw := range storage.Cdnurl {
		if _, err := url.Parse(raw); err == nil {
			return raw, nil
		}
	}
	return "", fmt.Errorf("no usable cdn url in %d candidate(s)", len(storage.Cdnurl))
}

// Drop Spotify's custom first Ogg page so what we hand out is a plain Ogg Vorbis bitstream.
//
// The decrypted file is already valid Ogg; its first page carries a seek table and replay-gain
// data instead of a Vorbis header, and a decoder handed that page rejects the stream.
// go-librespot strips it in vorbis.ExtractMetadataPage, which returns a reader positioned just
// past the page. Doing the page arithmetic here instead of calling that keeps the CGO decoder out
// of the build: an Ogg page is a 27-byte header, a one-byte-per-segment table, then the segment
// bodies.
func trimMetadataPage(r io.ReaderAt, size int64) (*io.SectionReader, error) {
	const headerLen = 27
	head := make([]byte, headerLen)
	if _, err := r.ReadAt(head, 0); err != nil {
		return nil, fmt.Errorf("failed reading ogg page header: %w", err)
	}
	if !bytes.Equal(head[0:4], []byte("OggS")) {
		return nil, fmt.Errorf("decrypted stream is not an ogg bitstream (got %q): wrong audio key?", head[0:4])
	}

	segments := int(head[26])
	table := make([]byte, segments)
	if _, err := r.ReadAt(table, headerLen); err != nil {
		return nil, fmt.Errorf("failed reading ogg segment table: %w", err)
	}
	pageLen := int64(headerLen + segments)
	for _, seg := range table {
		pageLen += int64(seg)
	}
	if pageLen >= size {
		return nil, fmt.Errorf("metadata page (%d bytes) covers the whole file (%d bytes)", pageLen, size)
	}
	return io.NewSectionReader(r, pageLen, size-pageLen), nil
}

func parseTrackId(uri string) (*librespot.SpotifyId, error) {
	if len(uri) > 0 && uri[0] != 's' {
		uri = "spotify:track:" + uri
	}
	id, err := librespot.SpotifyIdFromUri(uri)
	if err != nil {
		return nil, fmt.Errorf("invalid track uri %q: %w", uri, err)
	}
	if id.Type() != librespot.SpotifyIdTypeTrack {
		return nil, fmt.Errorf("%q is a %s, not a track", uri, id.Type())
	}
	return id, nil
}

func firstArtist(t *metadatapb.Track) string {
	if len(t.Artist) == 0 {
		return "?"
	}
	return t.Artist[0].GetName()
}
