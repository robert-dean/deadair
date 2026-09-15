options {
    keys: {
        area: podcasts
    }
    services: {
        PodcastsService: "#src/modules/podcasts/podcasts.service.js"
    }
    security: {
        # The floor for the file is the reads, which fan out to plugins or read the station's own
        # table on behalf of the console, on the `platform.view` floor the news and charts pages use.
        # Asking for a refresh is an operator action and says so on its own verb.
        policy: platform.view
    }
}

# Somebody else's programmes, out of whatever podcast plugins are installed, and the episodes of them
# the station knows about. Nothing here schedules or airs anything: a clock band does that.

operation /podcasts/shows: {
    get: { # Every programme every installed podcast plugin carries
        name: List shows
        service: PodcastsService.readShows
        response: {
            200: {
                application/json: StationShowList
            }
        }
    }
}

operation /podcasts/search: {
    get: { # Looks a show up in the directories the installed podcast plugins can search
        name: Search podcast directory
        service: PodcastsService.searchDirectory
        query: StationDirectoryQuery
        security: {
            # An operator action rather than a read: the words go to somebody else's directory.
            policy: platform.manage
        }
        response: {
            200: {
                application/json: StationDirectoryPage
            }
        }
    }
}

operation /podcasts/episodes: {
    get: { # The episodes the station knows about, newest first, with what it has done with each
        name: List episodes
        service: PodcastsService.readEpisodes
        query: StationEpisodeQuery
        response: {
            200: {
                application/json: StationEpisodePage
            }
        }
    }
}

operation /podcasts/episodes/{id}/fetch: {
    params: {
        id: string(min=1, max=100)
    }
    post: { # Fetches one episode's audio into the station's store now, rather than waiting for its slot to come near
        name: Fetch episode
        service: PodcastsService.requestFetch
        security: {
            # An operator action: it downloads a programme, which can be a few hundred megabytes.
            policy: platform.manage
        }
        response: {
            200: {
                application/json: StationEpisode
            }
        }
    }
}

operation /podcasts/refresh: {
    post: { # Reads every show's feed again, in the background, rather than waiting for the next scheduled refresh
        name: Refresh podcasts
        service: PodcastsService.requestRefresh
        security: {
            # An operator action: it spends requests against every publisher on the list.
            policy: platform.manage
        }
    }
}
