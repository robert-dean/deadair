options {
    keys: {
        area: news
    }
    services: {
        NewsService: "#src/modules/news/news.service.js"
    }
    security: {
        # The floor for both operations in this file. Both are reads that fan out to plugins on
        # behalf of the console, so they sit on the same `platform.view` floor as the charts and the
        # catalog. Nothing overrides it.
        policy: platform.view
    }
}

# What happened outside the station, out of whatever news plugins are installed.
#
# A menu rather than a merge, exactly like the charts routes: two news services are two newsrooms,
# so these enumerate and never combine. Nothing here schedules or airs anything.

operation /news/feeds: {
    get: { # Every feed every installed news plugin currently offers
        name: List feeds
        service: NewsService.readFeeds
        response: {
            200: {
                application/json: StationFeedList
            }
        }
    }
}

operation /news: {
    get: { # Published entries, newest first
        name: Read news
        service: NewsService.readNews
        query: NewsQuery
        response: {
            200: {
                application/json: NewsPage
            }
        }
    }
}
