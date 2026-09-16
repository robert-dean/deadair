options {
    keys: {
        area: narrations
    }
}

contract StationSeries: { # Something the station can read out, as one installed plugin describes it
    id: string(min=1, max=400) # Unique across the station: the plugin's own id for the series, qualified with the plugin that offered it
    pluginId: string(min=1, max=200)
    title: string(min=1, max=600) # What the series is called, which is what a presenter says out loud
    order: enum(serial, latest) # How it is worked through: `serial` from the beginning in order, `latest` its newest piece and nothing once that has aired
    author?: string(max=600)
    description?: string(max=4000) # What the series says about itself, as plain text
    artworkUrl?: string(max=2000)
    homeUrl?: string(max=2000)
    language?: string(max=40) # ISO 639-1, or the source's own tag. Also what the station splits sentences by when it cuts a long piece up
}

contract StationSeriesList: {
    series: array(StationSeries)
}

contract StationPiece: { # One instalment, and what the station has done with it
    id: string(min=1, max=100) # The station's own id for this piece
    seriesId: string(min=1, max=400) # Qualified, matching `StationSeries.id`
    pieceId: string(min=1, max=1000) # The plugin's own id for the piece, stable across refreshes
    seriesTitle: string(min=1, max=600)
    title: string(min=1, max=1000)
    order: enum(serial, latest) # How its series is worked through, copied onto the piece by every refresh
    author?: string(max=600)
    summary?: string(max=4000) # What it is about, as plain text
    url?: string(max=2000) # The piece's page, for a person
    artworkUrl?: string(max=2000)
    ordinal?: int(min=0) # Where it comes in a serial, from 0. Absent for a `latest` series
    publishedAt?: string(max=40) # ISO-8601
    wordCount?: int(min=0) # Roughly how many words it runs to, as the plugin counted them
    seenAt: string(max=40) # ISO-8601: when a refresh last saw it listed
    rendered: boolean # Whether the station has the spoken audio, ready to air
    rendering: boolean # Whether the words are being spoken right now
    renderRequestedAt?: string(max=40) # ISO-8601: when the station last asked for it to be spoken
    renderError?: string(max=2000) # Why the last attempt to speak it failed, when it did
    scheduledFor?: string(max=40) # ISO-8601: the slot it was made for
    airedAt?: string(max=40) # ISO-8601: when a listener could first have heard it. A piece airs once, and for a serial this is also the station's place in the book
}

contract StationPieceQuery: {
    seriesId?: string(max=400) # One series' pieces in its own order, or absent for every series' newest first
    limit?: int(min=1, max=500)
}

contract StationPiecePage: {
    pieces: array(StationPiece) # Empty when the station knows of none, which is not an error
}
