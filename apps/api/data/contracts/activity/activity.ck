options {
    keys: {
        area: activity
    }
    services: {
        ActivityService: "#src/modules/activity/activity.service.js"
    }
    security: {
        # A read, so `platform.view`, which both platform roles grant.
        #
        # Deliberately not the `platform.manage` floor the plugin log routes sit on. That floor is
        # there because plugin log output is whatever a plugin chose to write and a careless one can
        # put a token in a line; everything here is the app's own sentences over its own structured
        # rows, so the same caution would be cargo-culted rather than earned.
        policy: platform.view
    }
}

# What the station has been doing, as one time-ordered list.
#
# Three sources behind one read: the station's own moments, a break's journey through the render
# pipeline, and the records that actually aired. None of them is copied into the others.

operation /activity: {
    get: { # The feed, newest first, one page at a time
        name: Read activity
        service: ActivityService.readActivity
        query: ActivityQuery
        response: {
            200: {
                application/json: ActivityPage
            }
        }
    }
}
