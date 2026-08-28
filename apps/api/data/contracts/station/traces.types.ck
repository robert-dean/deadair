options {
    keys: {
        area: station
    }
}

# Whether a call produced what it was asked for. Two values on purpose: every finer distinction —
# timed out, was preempted, came back empty — is a fact the caller knew and the recorder did not, so
# it lives in `detail` where it can be named
contract TraceOutcome: enum(ok, failed)

contract TraceSpan: { # One call inside a decision, and what it cost
    at: datetime # When the call ended, which is when its cost was known
    op: string(min=1, max=100) # Dotted and stable: `job.run`, `plugin.invoke`, `llm.generate`
    target?: string(max=300) # Which one: a plugin and its method, or a model
    ms: int(min=0) # How long it held, measured around the call rather than reported by it
    outcome: TraceOutcome
    error?: string(max=300) # The failure, summarized to a shape rather than a stack
    detail?: record(string, unknown) # Whatever this `op` is worth reading back: tokens, a finish reason, the bound it was given
}

contract TraceDecision: { # One decision, folded: a job execution or a request
    id: string(min=1, max=200) # The job id or the request id. Already the station's correlation id, never generated for this
    kind: string(min=1, max=200) # A queue name, or a method and path
    parent?: string(max=200) # The decision that enqueued this one. Absent on a request, a cron job and anything at boot
    at: datetime # When its first recorded call ended
    ms: int(min=0) # Wall clock, off the `job.run` span. Zero for a decision recorded before that span existed
    calls: int(min=0) # Everything it did, not counting the `job.run` that contains them
    failed: int(min=0) # How many of those did not produce what they were asked for
}

contract TracesQuery: { # Which slice of the kept window to read
    limit?: int(min=1, max=200)
    kind?: string(max=200) # An exact queue name or route, for reading one kind of decision on its own
    failedOnly?: boolean # Only decisions carrying at least one failed call
}

contract TracesPage: {
    decisions: array(TraceDecision) # Newest first
    total: int(min=0) # How many the window holds before `limit`, so a page can say it is showing a slice
    spans: int(min=0) # How many calls were read to answer, which is the honest cost of this page
}

contract TraceDetail: { # One decision, its calls, and the decisions on either side of it
    decision: TraceDecision
    spans: array(TraceSpan) # In the order they happened
    parent?: TraceDecision # What enqueued this, when that decision is still inside the kept window
    caused: array(TraceDecision) # What this one went on to enqueue
}
