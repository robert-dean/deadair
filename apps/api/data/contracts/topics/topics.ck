options {
    keys: {
        area: topics
    }
    services: {
        TopicsService: "#src/modules/topics/topics.service.js"
    }
    security: {
        # The floor is the WRITE end, as in the schedule, the clock and the personas: this file is
        # two reads and three writes, so a route added without a block of its own is likelier to be
        # another write, and inheriting the tighter gate is the failure that gets reported rather
        # than the one that goes quiet. The reads override it downward.
        policy: platform.manage
    }
}

# What the station's breaks can be ABOUT. News categories today — US, world, the local one only this
# operator can name, technology — and the same shape is what a weather break's locations will be,
# which is why this is a vocabulary keyed by sort of break rather than a news feature.
#
# Every mutation answers the whole list, as the schedule and the personas do: the rows are read
# together and a caller handed back only the one it named is holding a list it has to refetch anyway.

operation /topics: {
    get: { # Every subject this station has named, for one sort of break or for all of them
        name: List topics
        service: TopicsService.list
        security: {
            # A read, so it drops to the floor the console's other pages use.
            policy: platform.view
        }
        query: TopicQuery
        response: {
            200: {
                application/json: TopicList
            }
        }
    }
    post: { # Names a new subject. Nothing uses it until something points at it
        name: Create topic
        service: TopicsService.create
        request: {
            application/json: Topic
        }
        response: {
            201: {
                application/json: TopicList
            }
        }
    }
}

# Separate from the list rather than a field on each row, because this is what the station can DO
# rather than what the operator has said: which sorts of break take subjects at all, and which fields
# one of theirs is written with. It changes when a station gains a capability, not when somebody
# edits a row.

operation /topics/kinds: {
    get: { # Which sorts of break have subjects, and the form each one's settings are edited with
        name: List topic kinds
        service: TopicsService.kinds
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: TopicKindList
            }
        }
    }
}

operation /topics/{id}: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Rewrites one subject. A break already written keeps the words it was given
        name: Update topic
        service: TopicsService.update
        request: {
            application/json: Topic
        }
        response: {
            200: {
                application/json: TopicList
            }
        }
    }
    delete: { # Removes a subject, and any band on the format clock that asked for it
        name: Delete topic
        service: TopicsService.remove
        response: {
            200: {
                application/json: TopicList
            }
        }
    }
}
