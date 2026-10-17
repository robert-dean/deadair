options {
    keys: {
        area: metrics
    }
}

# How wide one point is. Chosen by the station from the range asked for: minutes for two days or less, hours beyond
contract MetricResolution: enum(minute, hour)

contract MetricSeriesQuery: { # The trends to read, over one range
    names: string(min=1, max=1000) # Comma-separated metric names, at most twenty: `station.listeners,work.job.ms`
    from: datetime # The start of the range, inclusive
    to: datetime # The end of the range, exclusive. At most four hundred days after `from`
}

contract MetricPoint: { # One series over one minute or hour
    at: datetime # The start of the minute or hour
    count: number(min=0) # How many observations were folded in
    sum: number # Their total: a counter's value, or with `count` a duration's mean
    min: number # The smallest observation
    max: number # The largest observation: a duration's worst
    last: number # The latest observation: a gauge's value
}

contract MetricSeries: { # One metric and one set of labels, its points oldest first
    name: string(min=1, max=200)
    labels: record(string, string) # What tells this series from the metric's others: `{ "queue": "catalog.sync" }`. Empty for a metric with one series
    source: string(min=1, max=50) # `station` for what the station measured itself, `otlp` for what another service sent it
    points: array(MetricPoint) # Only the buckets that hold something. A gap is a stretch nothing was measured, which a chart should draw as a gap
}

contract MetricSeriesPage: {
    resolution: MetricResolution # The width the points were read at
    from: datetime
    to: datetime
    series: array(MetricSeries) # Empty when nothing was measured in the range, which is not an error
}

contract MetricName: { # A metric the station holds, for a picker
    name: string(min=1, max=200)
    source: string(min=1, max=50)
    labelKeys: array(string(min=1, max=200)) # Every label any of its series carries, sorted
    lastSeen: datetime # The newest point held for it, at either resolution
}

contract MetricNames: {
    names: array(MetricName) # Sorted by name
}

# An OTLP/HTTP metrics export, sent as JSON. Only the top level is checked here; the station reads the rest itself and counts what it cannot use rather than refusing the whole request
contract mode(loose) OtlpMetricsExport: {
    resourceMetrics: array(object, max=1000)
}

contract OtlpPartialSuccess: { # OTLP's answer when some points were not taken
    rejectedDataPoints: string # How many, as OTLP writes a 64-bit count: a digit string
    errorMessage: string(max=500)
}

contract OtlpExportResponse: { # OTLP's answer to an export. Empty when every point was taken
    partialSuccess?: OtlpPartialSuccess
}
