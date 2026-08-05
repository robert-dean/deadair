package main

import (
	"bytes"
	"io"
	"testing"
)

// trimMetadataPage is the only original logic in the shim: everything else composes
// go-librespot's own packages. It replaces vorbis.ExtractMetadataPage (which we cannot call
// without dragging libvorbis into the build), so the page arithmetic has to be right or we hand
// Liquidsoap a stream whose first page is Spotify's seek table instead of a Vorbis header.

// One Ogg page: 27-byte header, one length byte per segment, then the segment bodies.
func oggPage(segments []int, fill byte) []byte {
	page := make([]byte, 27)
	copy(page, "OggS")
	page[26] = byte(len(segments))
	for _, n := range segments {
		page = append(page, byte(n))
	}
	for _, n := range segments {
		page = append(page, bytes.Repeat([]byte{fill}, n)...)
	}
	return page
}

func TestTrimMetadataPageDropsExactlyTheFirstPage(t *testing.T) {
	audio := []byte("OggS-second-page-is-the-real-vorbis-stream")
	file := append(oggPage([]int{255, 60}, 0xAA), audio...)

	r, err := trimMetadataPage(bytes.NewReader(file), int64(len(file)))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("unexpected read error: %v", err)
	}
	if !bytes.Equal(got, audio) {
		t.Fatalf("trimmed to %q, want %q", got, audio)
	}
}

func TestTrimMetadataPageHandlesAnEmptySegmentTable(t *testing.T) {
	audio := []byte("audio")
	file := append(oggPage(nil, 0), audio...)

	r, err := trimMetadataPage(bytes.NewReader(file), int64(len(file)))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, _ := io.ReadAll(r)
	if !bytes.Equal(got, audio) {
		t.Fatalf("trimmed to %q, want %q", got, audio)
	}
}

// A wrong audio key produces bytes that decrypt to noise. Catching it here names the cause,
// rather than letting Liquidsoap fail to decode something that was never audio.
func TestTrimMetadataPageRejectsANonOggStream(t *testing.T) {
	file := bytes.Repeat([]byte{0x7f}, 512)
	if _, err := trimMetadataPage(bytes.NewReader(file), int64(len(file))); err == nil {
		t.Fatal("expected an error for a stream that is not ogg")
	}
}

func TestTrimMetadataPageRejectsAPageCoveringTheWholeFile(t *testing.T) {
	file := oggPage([]int{100}, 0xAA)
	if _, err := trimMetadataPage(bytes.NewReader(file), int64(len(file))); err == nil {
		t.Fatal("expected an error when nothing follows the metadata page")
	}
}
