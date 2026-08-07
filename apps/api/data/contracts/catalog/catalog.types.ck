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
