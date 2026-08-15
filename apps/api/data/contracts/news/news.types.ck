options {
    keys: {
        area: news
    }
}

contract StationFeed: { # A feed one installed plugin offers
    id: string(min=1, max=400) # Unique across the station: the plugin's own id for the feed, qualified with the plugin that offered it. Two services both calling something `world` stay distinct
    pluginId: string(min=1, max=200)
    name: string(min=1, max=200)
    category?: string(max=200) # Broad subject, in the publisher's own word for it
    language?: string(max=10) # ISO 639-1, when the plugin knows
    description?: string(max=2000)
}

contract StationFeedList: {
    feeds: array(StationFeed)
}

contract NewsStory: { # One published entry
    id: string(min=1, max=600) # Stable for the same entry across calls, which is what lets a reader tell an arrival from something it has already seen
    feedId: string(min=1, max=400) # Qualified, matching `StationFeed.id`
    feedName: string(min=1, max=200)
    title: string(min=1, max=600)
    summary?: string(max=2000) # Plain text. Never markup: this is written to be read out
    url?: string(max=2000)
    publishedAt?: string(max=40) # ISO-8601
    categories?: array(string(min=1, max=200))
}

contract NewsQuery: {
    feedId?: string(max=400) # One feed, or absent for every feed the station can see, merged newest first
    limit?: int(min=1, max=100)
    since?: string(max=40) # Only entries published after this ISO-8601 instant
}

contract NewsPage: {
    stories: array(NewsStory) # Newest first. Empty when nothing could be read, which is deliberately not an error: the news is something the station may talk about, never something it needs to air
}
