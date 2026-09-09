options {
    keys: {
        area: station
    }
}

# One concrete thing an attention row is about, so the reason does not live a page away.
#
# The row above it counts and categorises; this names. "4 records have no copy left that will play"
# is a category an operator can do nothing with until they know WHICH four and WHY each one, and
# every one of those facts was already stored — the fetch error on `track_audio.last_error`, the
# provider's refusal on `track_sources.playable` — and reachable only by finding the record and
# hovering a cell on its page. This is that fact travelling with the row that counted it.
contract AttentionEvidence: {
    label: string(min=1, max=300) # The thing itself, as an operator would name it: a record's title and who made it
    reason: string(min=1, max=600) # Why THIS one, in the station's own sentence. The row's `detail` says what the category means; this says what happened here
    route?: string(min=1, max=200) # The page holding the whole of it. Absent where there is no page for it, which the running order can hold: a record the catalog never ingested has none
}

# One thing that wants the operator's attention, or the fact that nothing does
contract AttentionItem: {
    code: string(min=1, max=60) # What this is, as a stable key: `silence`, `benchedCopies`, `noPersona`. The console groups and counts on it rather than on the sentence
    severity: enum(failure, warning, notice) # `failure` is the station not doing its job, `warning` is something failing beside a station that is working, and `notice` is a thing nobody has set up yet. A notice is not a fault and must not be drawn as one
    title: string(min=1, max=120) # The line an operator reads first
    detail: string(min=1, max=800) # The whole of it, in a sentence. Where the station already has words for a fact, these are those words rather than a second phrasing of them
    route: string(min=1, max=200) # The console page that can do something about it
    count?: int(min=0) # How many things this is about, where that is a number rather than a state
    evidence?: array(AttentionEvidence) # A HANDFUL of the things this row is about, never all of them: this answer is polled and a row about four hundred records must not be four hundred sentences. `count` stays the true figure, and a console showing fewer than it says so
}

# Everything wrong or waiting, worst first
contract StationAttention: {
    items: array(AttentionItem)
}

# One loop the station runs, and when it last came round.
#
# Two timestamps and no verdict, because the loop cannot supply one: a five-second reconcile and a
# nightly sweep are both healthy and no single threshold describes both. `Heartbeat` itself takes
# this position — it answers how long it has been and lets the reader decide — and a `stalled`
# boolean here would be this module inventing the threshold that file deliberately refuses to.
#
# `lastBeat` is absent until a loop finishes its first pass, which is why `startedAt` is there: from
# the two of them a reader can tell a loop that has never completed anything from one that stopped.
contract StationHeartbeat: {
    name: readonly string(min=1, max=100)
    startedAt: readonly datetime # When the loop registered, which is when it was last (re)started
    lastBeat?: readonly datetime # When it last completed a pass. Absent until it completes its first
}

# How much of the library the station has actually looked at.
#
# The counts `/catalog/tracks` already answers with, lifted out of a page of rows: a check-up wants
# the sentence "13 of 581 measured" without asking for thirteen tracks to get it.
contract StationBacklog: {
    total: readonly int(min=0)
    cached: readonly int(min=0)
    measured: readonly int(min=0)
}

# One reading of the machinery, for a page that assembles the station's health.
#
# It carries ONLY the two signals nothing else exposes. Everything else a check-up shows — the
# silence verdict, the listener count, what needs somebody, the plugin statuses, the disk — is
# already on a contract the console reads, and composing them again here would be a second answer
# that can disagree with the first. `/playout/status` in particular is polled every two seconds for
# the transport strip, so asking for it a second way would be a second reading of the same fact.
#
# Each section is OPTIONAL and absent means that reader failed. A page saying what is wrong is the
# worst place for one broken reader to take the whole answer down, which is the rule
# `StationAttentionService` already works to. `revision` is the one exception and says so on its
# own line: it cannot fail, so absent there means something else.
#
# The revision is on THIS contract rather than composed from `/health`, which also reports it, and
# that is not the second-answer problem the paragraph above describes. Both read one string from one
# place at boot, so they cannot disagree. What they differ in is who can reach them: `/health` is
# `operation(internal)`, deliberately, so it generates no SDK method and the console cannot call it
# — which would leave "which build is this" answerable only from a shell, the one thing carrying it
# here exists to fix.
contract StationCheckup: {
    readAt: readonly datetime # When this reading was taken, so a stale page cannot pass itself off as now
    revision?: readonly string(min=1, max=100) # The commit this station was built from, as the image's `org.opencontainers.image.revision` label says it. Unlike the sections below, absent is not a failed reader: it means nothing stamped this build, which is what a development tree and a hand-built image both are
    version?: readonly string(min=1, max=50) # The release this station is, as the image's `org.opencontainers.image.version` label says it. Absent on the same terms as `revision` and for a second reason: only a tagged build carries one, so a station following `latest` reports a commit and no version
    heartbeats?: readonly array(StationHeartbeat)
    backlog?: readonly StationBacklog
}
