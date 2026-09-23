options {
    keys: {
        area: station
    }
    services: {
        StationAttentionService: "#src/modules/station/station.attention.service.js"
        StationCheckupService: "#src/modules/station/station.checkup.service.js"
        StationReleasesService: "#src/modules/station/station.releases.service.js"
    }
    security: {
        # Reads, so the floor is the read gate every console page sits on. Nothing in this area writes
        # anything: it composes facts other modules own. The one action, asking GitHub for releases
        # now, raises its own gate below.
        policy: platform.view
    }
}

# What needs somebody, composed across the whole station rather than left on the page that happens to
# hold each fact. Every one of these was already readable somewhere — a benched copy on the catalog, a
# silence on the transport, a plugin that will not start on its own card — which is exactly the
# problem: an operator has to already be on the page to find out that page has something wrong on it.
#
# The station's own sentences are reused rather than rewritten. The silence diagnosis composes ten
# gates and words the answer, and a second wording here would be a second thing to disagree with it.

operation /station/attention: {
    get: { # Everything wrong or waiting, worst first, each with the console page that can act on it
        name: Read station attention
        service: StationAttentionService.read
        response: {
            200: {
                application/json: StationAttention
            }
        }
    }
}

# The machinery, for the page that assembles a check-up.
#
# It adds no probing of its own: every number here is already being kept in memory or in a table, and
# this is the reader that was missing. What it deliberately does NOT do is duplicate the four facts
# the console already polls for other reasons — the silence verdict, the audience, the plugin
# statuses and the disk — because a second composition of those is a second thing to disagree with
# the first.
#
# `/health` is not the place for any of this and stays as it is: a probe that consults subsystems
# reports a station with an unreachable stream as a dead API, and a restart is the one repair that
# cannot help.
operation /station/checkup: {
    get: { # The loops the station runs and how much of the library it has looked at
        name: Read station checkup
        service: StationCheckupService.read
        response: {
            200: {
                application/json: StationCheckup
            }
        }
    }
}

# What changed in each release, from the changelog the image was built with. A station with no route
# to the internet still has these, because they are part of the build rather than something fetched.

operation /station/releases: {
    get: { # The releases this build contains and what each one changed, newest first
        name: Read station releases
        service: StationReleasesService.read
        response: {
            200: {
                application/json: StationReleases
            }
        }
    }
}

# Ask GitHub now rather than at the next scheduled check, which is what an operator reaches for right
# after hearing a release went out.

operation /station/releases/check: {
    post: { # Asks GitHub for newer releases now, and answers with what the station then knows
        name: Check station releases
        service: StationReleasesService.check
        # Manage rather than view: it makes the station send a request to the internet, and GitHub's
        # allowance is per address, so it is an operator's action and not a reader's.
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: StationReleases
            }
        }
    }
}
