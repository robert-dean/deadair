options {
    keys: {
        area: history
    }
    services: {
        HistoryService: "#src/modules/history/history.service.js"
    }
    security: {
        # A read, so `platform.view`, which both platform roles grant. The same floor the activity
        # feed sits on, and for the same reason: this is the station's own account of its own
        # programming, which is the least private thing it holds — a listener heard all of it.
        policy: platform.view
    }
}

# What the station has played, newest first.
#
# `play_history` is written from the rundown's own `onAired`, so a row here is a record a listener
# actually heard rather than one handed to the player. The catalog is joined for the cover and the
# running time, which the history table does not carry and a client showing a list of records wants.

operation /history: {
    get: { # What the station played, newest first, one page at a time
        name: Read history
        service: HistoryService.readHistory
        query: HistoryQuery
        response: {
            200: {
                application/json: HistoryPage
            }
        }
    }
}

# What actually went out, newest first: every record, break and programme, with when each started
# and ended, and the gaps and air changes between them.
#
# The items are `deadair.as_run`, written on the rundown's own `onAired` edge. The gaps and the air
# changes are read from `station_events` rather than copied, so they reach back only as far as the
# activity feed is kept.

operation /history/as-run: {
    get: { # The as-run log, newest first, one page at a time
        name: Read as-run log
        service: HistoryService.readAsRun
        query: AsRunQuery
        response: {
            200: {
                application/json: AsRunPage
            }
        }
    }
}
