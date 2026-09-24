options {
    keys: {
        area: playlists
    }
}

# A playlist the station owns: records it holds in its own library, in an order somebody chose, cloned
# from somewhere else and free to differ from it afterwards
contract StationPlaylist: {
    id: readonly string(min=1, max=100)
    name: string(min=1, max=200)
    prompt: string(max=4000) # What this playlist is for, in the operator's own words. Empty when nobody said
    originPluginId?: readonly string(max=200) # The plugin this was cloned from, for a badge and nothing else. Absent for one read from a file or made here
    trackCount: readonly int(min=0) # Every row, placeholders included
    resolvedCount: readonly int(min=0) # The rows that name a record in the library, which are the ones that can air
    createdAt: readonly datetime
    updatedAt: readonly datetime
}

contract StationPlaylistList: {
    playlists: array(StationPlaylist)
}

# One row of a station playlist: a record in the library, or a placeholder for one it does not hold yet
contract StationPlaylistTrack: {
    id: string(min=1, max=100) # The row's own id, not the record's
    position: int(min=0)
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200)) # Ordered, primary artist first
    album?: string(max=400)
    durationMs?: int(min=0)
    trackId?: string(max=100) # The library record this row plays. Absent on a placeholder
    artistId?: string(max=100)
    albumId?: string(max=100)
    originPluginId?: string(max=200) # On a placeholder, the plugin whose copy it was cloned from. Absent on one read from a file, which names a record and no copy of it
}

contract StationPlaylistDetail: StationPlaylist & {
    tracks: array(StationPlaylistTrack)
}

# What may change about a station playlist after it exists. Absent fields are left alone
contract StationPlaylistUpdate: {
    name?: string(min=1, max=200)
    prompt?: string(max=4000)
}

# Where a record in a file came from, when it came from a provider's copy. Carried so a record the
# receiving library does not hold can still be matched by that copy later
contract PlaylistFileOrigin: {
    pluginId: string(min=1, max=200)
    externalId: string(min=1, max=400)
}

# One record as a playlist file names it. By its words and its ISRC, never by an id of this station's:
# ids are minted afresh by every library, so a file keyed by them would restore onto nothing
contract PlaylistFileTrack: {
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200)) # Ordered, primary artist first
    album?: string(max=400)
    durationMs?: int(min=0)
    isrc?: string(max=100)
    origin?: PlaylistFileOrigin
}

# A playlist as a file: everything somebody would need to rebuild it on another station
contract PlaylistFile: {
    format: string(min=1, max=50) # What shape this is, so a file from a later build says so rather than being read wrongly
    takenAt: string(min=1, max=40) # When it was exported, ISO-8601
    station?: string(max=100) # The station it was taken from. Provenance only
    name: string(min=1, max=200)
    prompt?: string(max=4000)
    tracks: array(PlaylistFileTrack)
}

# A playlist one of the station's music sources holds, named the way the playlists listing names it
contract PlaylistProviderRef: {
    pluginId: string(min=1, max=200)
    playlistId: string(min=1, max=400)
}

# Something to import a playlist from. Exactly one source
contract PlaylistImportInput: {
    file?: PlaylistFile # A playlist exported from a deadair station
    text?: string(min=1, max=4000000) # A playlist another program wrote, as its text: an M3U, a CSV with a header row, or one `Artist - Title` per line
    format?: enum(m3u, csv, text) # Which of those `text` is. Absent works it out from the text
    fileName?: string(max=400) # The name of the file `text` came from, which names the playlist when the text does not
    url?: string(min=1, max=2000) # A link to a playlist at one of the station's music sources, as a browser or an app shows it
    providerPlaylist?: PlaylistProviderRef # A playlist a music source lists here, by its plugin and its id
    name?: string(min=1, max=200) # What to call the new playlist. Absent keeps the name the source gives it
}

# What importing one record would do here
contract PlaylistImportEntry: {
    position: int(min=0)
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200))
    outcome: enum(
        matched,
        toAdd,
        toLookUp
    ) # `matched`: the library holds it. `toAdd`: it names a provider's copy, which the station can add to its library. `toLookUp`: it names only a record, which the station has to search its providers for
    trackId?: string(max=100) # The library record a `matched` row plays
}

# What an import WOULD do, written nowhere
contract PlaylistImportPlan: {
    name: string(min=1, max=200)
    matched: int(min=0)
    toAdd: int(min=0)
    toLookUp: int(min=0)
    skipped: int(min=0) # Lines of the source that named no record the station could read
    entries: array(PlaylistImportEntry)
    notices: array(string(max=1000)) # Anything about the source as a whole an operator should know before importing it
}

contract PlaylistImportResult: {
    plan: PlaylistImportPlan
    playlist: StationPlaylist
}
