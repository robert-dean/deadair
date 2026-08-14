options {
    keys: {
        area: charts
    }
    services: {
        ChartsService: "#src/modules/charts/charts.service.js"
    }
    security: {
        # The floor for both operations in this file. Both are reads that fan out to plugins on
        # behalf of the console, so they sit on the same `platform.view` floor as the playlists and
        # the catalog. Nothing overrides it.
        policy: platform.view
    }
}

# What is popular, out of whatever chart plugins are installed.
#
# A menu rather than a merge: two services' top forties are two published documents, so these
# routes enumerate and never combine. Nothing here schedules anything.

operation /charts: {
    get: { # Every chart every installed chart plugin currently offers
        name: List charts
        service: ChartsService.readCharts
        response: {
            200: {
                application/json: StationChartList
            }
        }
    }
}

operation /charts/{id}: {
    params: {
        id: string(min=1, max=400)
    }
    get: { # One chart's records, ranked
        name: Read chart
        service: ChartsService.readChart
        query: ChartQuery
        response: {
            200: {
                application/json: ChartPage
            }
        }
    }
}
