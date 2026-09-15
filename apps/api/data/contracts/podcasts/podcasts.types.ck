options {
    keys: {
        area: podcasts
    }
}

contract StationShow: { # A programme the station carries, as one installed plugin describes it
    id: string(min=1, max=400) # Unique across the station: the plugin's own id for the show, qualified with the plugin that offered it
    pluginId: string(min=1, max=200)
    title: string(min=1, max=600) # What the show is called, which is what a presenter says out loud
    author?: string(max=600)
    description?: string(max=4000) # What the show says about itself, as plain text
    artworkUrl?: string(max=2000)
    homeUrl?: string(max=2000)
    feedUrl?: string(max=2000) # Where its feed is, when the plugin reads one
    language?: string(max=40)
    categories?: array(string(min=1, max=200))
    explicit?: boolean # Whether the publisher marked the whole show explicit. Absent means the publisher did not say, which is not the same as clean
}

contract StationShowList: {
    shows: array(StationShow)
}

contract StationEpisode: { # One episode of a programme the station carries, and what the station has done with it
    id: string(min=1, max=100) # The station's own id for this episode
    showId: string(min=1, max=400) # Qualified, matching `StationShow.id`
    episodeId: string(min=1, max=1000) # The plugin's own id for the episode, stable across refreshes
    showTitle: string(min=1, max=600)
    title: string(min=1, max=1000)
    summary?: string(max=4000) # What the publisher says it is about, as plain text
    url?: string(max=2000) # The episode's page, for a person
    publishedAt?: string(max=40) # ISO-8601
    durationMs?: int(min=0) # How long the publisher says it runs, in milliseconds
    artworkUrl?: string(max=2000)
    explicit?: boolean
    seenAt: string(max=40) # ISO-8601: when a refresh last saw it in its feed
    fetched: boolean # Whether the station holds its own copy of the audio, ready to air
    fetchRequestedAt?: string(max=40) # ISO-8601: when the station last asked for the audio
    fetchError?: string(max=2000) # Why the last attempt to fetch the audio failed, when it did
    scheduledFor?: string(max=40) # ISO-8601: the slot the audio was fetched for
    airedAt?: string(max=40) # ISO-8601: when a listener could first have heard it. An episode airs once
}

contract StationEpisodeQuery: {
    showId?: string(max=400) # One show's episodes, or absent for every show's, newest first
    limit?: int(min=1, max=200)
}

contract StationEpisodePage: {
    episodes: array(StationEpisode) # Newest first. Empty when the station knows of none, which is not an error
}
