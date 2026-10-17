options {
    keys: {
        area: metrics
    }
    services: {
        MetricsService: "#src/modules/metrics/metrics.service.js"
    }
    security: {
        # Reads, so `platform.view`, matching `/station/checkup`: these are the station's own numbers.
        # A series received over OTLP carries another service's metric names and labels, which are
        # numbers and short identifiers rather than free text, so the same floor holds for them.
        policy: platform.view
    }
}

# The station's numbers over time: listeners, how long its work took, what it asked the model for.

operation /metrics/series: {
    get: { # Trends over a range, at minute resolution for two days or less and hourly beyond
        name: Read metric series
        service: MetricsService.readSeries
        query: MetricSeriesQuery
        response: {
            200: {
                application/json: MetricSeriesPage
            }
        }
    }
}

operation /metrics/names: {
    get: { # Every metric the station holds, with its labels and when it was last measured
        name: Read metric names
        service: MetricsService.readNames
        response: {
            200: {
                application/json: MetricNames
            }
        }
    }
}
