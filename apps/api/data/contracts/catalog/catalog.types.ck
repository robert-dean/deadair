options {
    keys: {
        area: catalog
    }
}

# The canonical work, not a binding to a provider. `deadair.artists` minus the columns that
# only ingest cares about: `artist_key` is a match key, and a row with `merged_into_id` set is
# never read out at all.
#
# `imageUrl` on both contracts below is one field with two spellings. An absolute URL is the
# provider's own, still hotlinked because nothing has cached it yet; a relative `art/<uuid>` is
# the station's copy, to be resolved against the API base the client already configures (the API
# mounts at the root and does not know the `/api` prefix the edge adds). Prefer the local one by
# doing nothing: the switch happens server-side as soon as the art cache pass has the bytes.
contract Artist: {
    id: readonly uuid
    name: string
    mbid?: uuid # MusicBrainz artist id, absent until enrichment resolves one
    imageUrl?: string # Absolute upstream URL, or an API-relative path to the local copy
    rating: int(min=-1, max=1) = 0
    albumCount: readonly int(min=0) # Unmerged albums credited to this artist
    trackCount: readonly int(min=0) # Unmerged tracks credited to this artist
}

contract Album: {
    id: readonly uuid
    name: string
    artistId: readonly uuid
    artistName: readonly string # Joined, so a list renders without a second request per row
    mbid?: uuid # MusicBrainz release-group id, absent until enrichment resolves one
    year?: int
    imageUrl?: string # Absolute upstream URL, or an API-relative path to the local copy
    rating: int(min=-1, max=1) = 0
    trackCount: readonly int(min=0)
}

contract Track: {
    id: readonly uuid
    title: string
    artistId: readonly uuid
    artistName: readonly string
    albumId?: readonly uuid # Absent on a single ingested outside any release: `tracks.album_id` is nullable
    albumName?: readonly string
    albumImageUrl?: readonly string # The record's cover, in the two spellings `Album.imageUrl` has. Nothing hangs art off a recording
    artists: string # Display credit as written on the release ("X feat. Y"), not a join key
    genre?: string
    year?: int
    durationMs?: int(min=0)
    rating: int(min=-1, max=1) = 0
}

# Pagination plus a name filter. Every list operation here takes it, so the console's search box
# narrows server-side rather than filtering one page client-side and lying about the total.
contract CatalogQuery: Pagination & {
    search?: string(min=1, max=200)
}

# What enrichment stored, read back. Three payload shapes because the SDK has three: a recording,
# a performer and a record are asked about separately and know different things. The caps mirror
# the ones `enrichment.merge.ts` sanitizes to; change them together.

contract EnrichmentExternalId: {
    source: string(min=1, max=200) # e.g. `musicbrainz`, `wikidata`
    id: string(min=1, max=200)
}

# Narrowed to http(s) by the host before it is stored, since the console renders these as
# something a human clicks.
contract EnrichmentLink: {
    label: string(min=1, max=200)
    url: string(min=1, max=2000)
}

# `releaseDate` is a string and not `datetime` because it is a partial date: MusicBrainz answers
# `1997`, `1997-06` or `1997-06-24` depending on what is actually known about the release, and the
# SDK types it the same way. A `datetime` would reject the first two or invent a day and a time
# for them, which is a precision the source never claimed.
contract TrackEnrichmentData: {
    artist?: string(max=2000)
    title?: string(max=2000)
    album?: string(max=2000)
    year?: int
    releaseDate?: string(max=10)
    genres?: array(string(max=2000))
    moods?: array(string(max=2000))
    biography?: string(max=20000)
    facts?: array(string(max=2000)) # Short lines, each independently speakable
    bpm?: number # Not an integer: a tempo a source measured rather than declared is fractional
    musicalKey?: string(max=2000)
    label?: string(max=2000)
    isrc?: string(max=2000)
    artworkUrl?: string(max=2000)
    externalIds?: array(EnrichmentExternalId)
    links?: array(EnrichmentLink)
    extra?: record(string, unknown) # What the plugin said that the SDK has no field for. Per provider only: the merged view drops it
}

contract ArtistEnrichmentData: {
    name?: string(max=2000)
    biography?: string(max=20000)
    imageUrl?: string(max=2000)
    genres?: array(string(max=2000))
    facts?: array(string(max=2000))
    externalIds?: array(EnrichmentExternalId)
    links?: array(EnrichmentLink)
    extra?: record(string, unknown)
}

contract AlbumEnrichmentData: {
    name?: string(max=2000)
    artist?: string(max=2000) # The record's own credit, which is not always the track's
    year?: int
    releaseDate?: string(max=10) # Partial, exactly as on TrackEnrichmentData
    label?: string(max=2000)
    genres?: array(string(max=2000))
    facts?: array(string(max=2000))
    artworkUrl?: string(max=2000)
    externalIds?: array(EnrichmentExternalId)
    links?: array(EnrichmentLink)
    extra?: record(string, unknown)
}

# One provider's stored answer. `found: false` is a recorded miss, which is a fact rather than a
# failure: the provider was asked, had nothing, and is not asked again until `expiresAt`.
contract TrackEnrichmentSource: {
    provider: readonly string(min=1, max=200)
    providerRef?: readonly string(max=200) # The id it was fetched under. Provenance, not identity
    fetchedAt: readonly datetime
    expiresAt?: readonly datetime
    stale: readonly boolean # Past its TTL, so the next pass will ask again
    found: readonly boolean
    data: TrackEnrichmentData
}

contract ArtistEnrichmentSource: {
    provider: readonly string(min=1, max=200)
    providerRef?: readonly string(max=200)
    fetchedAt: readonly datetime
    expiresAt?: readonly datetime
    stale: readonly boolean
    found: readonly boolean
    data: ArtistEnrichmentData
}

contract AlbumEnrichmentSource: {
    provider: readonly string(min=1, max=200)
    providerRef?: readonly string(max=200)
    fetchedAt: readonly datetime
    expiresAt?: readonly datetime
    stale: readonly boolean
    found: readonly boolean
    data: AlbumEnrichmentData
}

# Every provider's answer, plus the same merge the promotion step used, so the console and the
# canonical columns cannot tell different stories. `sources` is empty on a row the walk has not
# reached yet.
contract TrackEnrichmentDetail: {
    trackId: readonly uuid
    merged: TrackEnrichmentData
    sources: array(TrackEnrichmentSource)
}

contract ArtistEnrichmentDetail: {
    artistId: readonly uuid
    merged: ArtistEnrichmentData
    sources: array(ArtistEnrichmentSource)
}

contract AlbumEnrichmentDetail: {
    albumId: readonly uuid
    merged: AlbumEnrichmentData
    sources: array(AlbumEnrichmentSource)
}
