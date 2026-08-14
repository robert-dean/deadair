options {
    keys: {
        area: charts
    }
}

contract StationChart: { # A chart one installed plugin offers
    id: string(min=1, max=400) # Unique across the station: the plugin's own id for the chart, qualified with the plugin that offered it. Two services both calling something `top-100` stay distinct
    pluginId: string(min=1, max=200)
    name: string(min=1, max=200)
    country?: string(max=10) # ISO 3166-1 alpha-2, when the chart is national. Absent means global
    genre?: string(max=200)
    description?: string(max=2000)
}

contract StationChartList: {
    charts: array(StationChart)
}

contract ChartRecord: { # One record's place in a chart
    rank: int(min=1)
    title: string(min=1, max=400)
    artist: string(min=1, max=200) # The lead artist alone. The other credits are in `featuring`
    featuring?: array(string(min=1, max=200))
    album?: string(max=400)
    year?: int(min=0)
    peak?: int(min=1) # Best position this record has reached, where the source tracks it
    weeksOn?: int(min=0) # How many editions it has appeared in, where the source tracks it
}

contract ChartQuery: {
    limit?: int(min=1, max=100)
    date?: string(max=10) # Which edition, as `YYYY-MM-DD`. Absent means the current one, and a service that keeps no history answers with the current one either way
}

contract ChartPage: {
    chartId: string(min=1, max=400)
    records: array(ChartRecord) # Ranked. Empty when the chart could not be read, which is deliberately not an error: a chart is something to look at, never something the station needs to air
}
