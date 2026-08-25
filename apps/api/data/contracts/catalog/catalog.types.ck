options {
    keys: {
        area: catalog
    }
}

# What the station has been told about a record. `neutral` is the absence of an opinion rather than
# a middling one, and it is what rating something back to nothing means.
contract Rating: enum(liked, neutral, disliked)

# Rate an artist, a record or a song. Ratings are absolute: a dislike anywhere above a track
# excludes it, and nothing the station programmes may turn that off.
contract RateInput: {
    rating: Rating
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
    rating: Rating = neutral
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
    rating: Rating = neutral
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
    rating: Rating = neutral
}

# One provider's copy of a record, with whatever the station holds of it.
#
# PER BINDING and never per track, which is the rule the whole page is built on: one canonical
# record may bind to several copies inside one provider, those copies are different files with
# different loudness and different cue points, and the one that airs is the one that was resolved.
# Collapsing them would make "clear the audio" ambiguous about which file it took.
#
# The failure columns are here rather than hidden because that is the question this page exists to
# answer. A row with `attempts` and no `fetchedAt` is a remembered failure, and `lastError` with
# `nextAttemptAt` is the whole of why a perfectly good-looking record will not play.
contract TrackBinding: {
    sourceId: readonly uuid # `track_sources.id`, which is also what the audio URL carries
    pluginId: readonly string(min=1, max=200)
    externalId: readonly string(min=1, max=400)
    playable: readonly boolean # False when the provider still knows the record but will not serve it here
    missingAt?: readonly datetime # When the station gave up on this copy. Cleared by the next sync that sees it again
    origin: readonly string(min=1, max=40) # `sync` if a playlist walk saw it, `discovered` if something looked it up
    bitrate?: readonly int(min=0)
    format?: readonly string(max=100)
    lastSeenAt?: readonly datetime
    # What the station holds of this copy, absent when nothing has ever fetched it.
    byteSize?: readonly int(min=0)
    fetchedAt?: readonly datetime
    lastServedAt?: readonly datetime
    attempts: readonly int(min=0) # CONSECUTIVE failures. Reset by a fetch that works
    lastError?: readonly string(max=2000)
    nextAttemptAt?: readonly datetime
}

# What the measurement sidecar made of a record.
#
# `complete` is NOT `analyzedAt`, and the two are separate fields for a reason `0005_music.sql`
# argues at length: a measurement of a truncated download is confident and wrong, so every reader in
# the app filters on `complete` and a page that showed only a date would be reporting a record as
# measured that nothing will use the measurement of.
contract TrackAnalysis: {
    schemaVersion: readonly int(min=0)
    complete: readonly boolean
    analyzer?: readonly string(max=200) # The measuring thing itself, which is not the plugin adapting it
    analyzerPluginId?: readonly string(max=200)
    analyzedAt?: readonly datetime
    failedAt?: readonly datetime
    failureReason?: readonly string(max=2000)
}

# One airing of a record, as this page needs it: when, and under which broadcast.
contract TrackPlay: {
    airedAt: readonly datetime
    broadcastId?: readonly uuid
    source: readonly string(min=1, max=100) # What put it in the running order
}

# Everything one record has accumulated, in one read.
#
# The enrichment is deliberately NOT here. It has its own operation already, answering
# `TrackEnrichmentDetail` with every provider's payload and the station's own sourced claims, and
# the console draws it through the same panel the list uses. One enrichment shape rather than two.
contract TrackDetail: Track & {
    bindings: array(TrackBinding)
    analysis?: TrackAnalysis # Absent for a record the walk has not reached
    plays: array(TrackPlay) # The most recent airings, newest first
    playCount: readonly int(min=0) # How many times in all, which the list above is only the head of
}

# What a clear actually did.
#
# A count rather than a bare 204, because the interesting answers are the small ones: clearing the
# audio of a record with three copies and being told `1` is the station saying two of them were
# never here — which is a fact about the record and not about the button.
contract TrackClearResult: {
    trackId: readonly uuid
    cleared: readonly int(min=0) # Rows this affected. Zero is an ordinary answer, not a failure
    detail: readonly string(min=1, max=400) # What happened, in the words the console shows
}

# Narrow a clear to one provider's answer, for the case where one source is wrong and the rest are
# not. Absent clears every provider's.
contract ClearEnrichmentQuery: {
    provider?: string(min=1, max=200)
}

# What an artist or album list is ordered BY, where `Pagination.sort` says only which direction.
#
#   name    the default, and the only key every row here has
#   albums  how many records the station holds of them. Artists only
#   tracks  how many songs. Artists only
#   year    when the record came out. Albums only
#   rating  the operator's own opinion
#
# One enum for both lists rather than two, because the alternative is a second near-identical
# contract whose only content is which two keys it drops. A key the row cannot answer falls back to
# name order rather than failing: an ordering nobody can serve is a page an operator cannot open.
contract CatalogSort: enum(name, albums, tracks, year, rating)

# Pagination plus a name filter. Every list operation here takes it, so the console's search box
# narrows server-side rather than filtering one page client-side and lying about the total.
contract CatalogQuery: Pagination & {
    search?: string(min=1, max=200)
    sortBy?: CatalogSort
}

# Which records to show, by what the station has of them rather than by what they are.
#
#   cached      the audio is on this machine, so it can be committed to the running order now
#   uncached    it is not, which for most of a library is ordinary rather than wrong
#   unmeasured  no trustworthy measurement, so no cue points and no level decided before air
#   benched     every copy written off, which is the one state that means it CANNOT air
#   failing     a fetch has failed and is backing off. Not benched yet, and often the state before it
contract TrackState: enum(cached, uncached, unmeasured, benched, failing)

# What a track list is ordered BY. Its own enum for `TrackQuery`'s own reason: none of these keys
# means anything about an artist, and `name` is spelled `title` on a song.
#
# `state` is deliberately absent. It is three independent booleans rather than one column, so there
# is no ordering of it an operator would agree with: a benched record and an unmeasured one are not
# more or less than each other.
contract TrackSort: enum(title, artist, album, year, duration, rating)

# A track list, narrowed by what the station has of each record as well as by name.
#
# Its own contract rather than a field on `CatalogQuery`, because that one is shared with the artist
# and album lists where none of these states means anything.
contract TrackQuery: CatalogQuery & {
    state?: TrackState
    sortBy?: TrackSort
}

# How much of the library is in each state, over the whole filtered set rather than this page.
#
# The aggregate is what an operator reads first — "13 of 581 measured" is the sentence that made
# `docs/todo/analysis-queue-ordering.md` necessary, and it was a psql query then. `total` is the
# same number as `meta.total` when nothing is filtered, and is repeated here so the counts can be
# read as N of M without reaching into the pager.
contract TrackStateCounts: {
    total: readonly int(min=0)
    cached: readonly int(min=0)
    measured: readonly int(min=0)
    enriched: readonly int(min=0)
    benched: readonly int(min=0)
    failing: readonly int(min=0)
}

# A track as a LIST shows it: the record, plus three facts about what the station has of it.
#
# Three booleans and no more, deliberately. They are what a row can afford — one `exists` each, off
# the query that was already running — and everything wider (which providers, how many bytes, why the
# last fetch failed) is `TrackDetail`'s, one click away. A fourth would be the beginning of putting
# the detail page in a table cell.
contract TrackRow: Track & {
    hasAudio: readonly boolean # The bytes are on this machine
    measured: readonly boolean # Measured, COMPLETE, and at a schema version the station still trusts
    enriched: readonly boolean # At least one provider has answered about it
}

# One page of each row type. Declared rather than inlined on the five list operations, so the shape
# has a name the console can import instead of restating `{ meta, data }` at every call site.
#
# Three near-identical contracts because the DSL has no generics. That is the honest expression of
# it: a union would type `data` as "artists or albums or tracks" and lose which one a given
# operation returns.

contract ArtistPage: { # One page of artists, with the totals the request was counted against
    meta: Pagination
    data: array(Artist)
}

contract AlbumPage: { # One page of albums
    meta: Pagination
    data: array(Album)
}

contract TrackPage: { # One page of tracks, with what the station has of each and of the whole set
    meta: Pagination
    data: array(TrackRow)
    states: TrackStateCounts
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
# failure: the provider was asked, had nothing, and is not asked again until `expiresAt`. A provider
# that could not be asked at all is `failed` instead, and the two never both hold.
contract TrackEnrichmentSource: {
    provider: readonly string(min=1, max=200)
    providerRef?: readonly string(max=200) # The id it was fetched under. Provenance, not identity
    fetchedAt: readonly datetime
    expiresAt?: readonly datetime
    stale: readonly boolean # Past its TTL, so the next pass will ask again
    found: readonly boolean
    failed: readonly boolean # The last attempt errored, so `expiresAt` is a backoff rather than a TTL
    data: TrackEnrichmentData
}

contract ArtistEnrichmentSource: {
    provider: readonly string(min=1, max=200)
    providerRef?: readonly string(max=200)
    fetchedAt: readonly datetime
    expiresAt?: readonly datetime
    stale: readonly boolean
    found: readonly boolean
    failed: readonly boolean # The last attempt errored, so `expiresAt` is a backoff rather than a TTL
    data: ArtistEnrichmentData
}

contract AlbumEnrichmentSource: {
    provider: readonly string(min=1, max=200)
    providerRef?: readonly string(max=200)
    fetchedAt: readonly datetime
    expiresAt?: readonly datetime
    stale: readonly boolean
    found: readonly boolean
    failed: readonly boolean # The last attempt errored, so `expiresAt` is a backoff rather than a TTL
    data: AlbumEnrichmentData
}

# One thing the station believes, and the words it read that say so. Extracted by the host out of
# an article a plugin handed over, rather than said by any plugin: `sourceUrl` is where a person
# checks it and `sourceQuote` is the span that supports it, and neither is ever absent.
contract FactClaim: {
    id: readonly uuid
    claim: readonly string(min=1, max=500) # One sentence, as the DJ would say it
    category: readonly string(min=1, max=40)
    source: readonly string(min=1, max=20) # `lead` for the article's own opening, `model` for what a model found
    sourceProvider: readonly string(min=1, max=200)
    sourceUrl: readonly string(min=1, max=2000)
    sourceQuote: readonly string(min=1, max=2000)
    confidence?: readonly number
    model?: readonly string(max=200)
    lastUsedAt?: readonly datetime # Absent means never said on air
}

# Every provider's answer, plus the same merge the promotion step used, so the console and the
# canonical columns cannot tell different stories. `sources` is empty on a row the walk has not
# reached yet.
#
# `claims` sits beside them rather than inside `merged`, because a claim is the host's own and not
# any provider's. The articles they were read out of are deliberately NOT here: raw source prose is
# stored and never sent.
contract TrackEnrichmentDetail: {
    trackId: readonly uuid
    merged: TrackEnrichmentData
    sources: array(TrackEnrichmentSource)
    claims: array(FactClaim)
}

contract ArtistEnrichmentDetail: {
    artistId: readonly uuid
    merged: ArtistEnrichmentData
    sources: array(ArtistEnrichmentSource)
    claims: array(FactClaim)
}

contract AlbumEnrichmentDetail: {
    albumId: readonly uuid
    merged: AlbumEnrichmentData
    sources: array(AlbumEnrichmentSource)
    claims: array(FactClaim)
}
