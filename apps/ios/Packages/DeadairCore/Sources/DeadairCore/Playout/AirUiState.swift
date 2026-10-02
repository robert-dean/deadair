import DeadairSdk

/// One plugin's playlists, under its name.
public struct PlaylistGroup: Equatable, Sendable {
    public let pluginId: String
    public let pluginName: String
    public let playlists: [CatalogPlaylist]
}

/// What can be put on air from the phone: every plugin's playlists, grouped by plugin, and the
/// charts anything offers.
///
/// A plugin that could not be asked is reported beside the ones that answered rather than failing the
/// page: one provider being down is the ordinary state of a station with several, and the other
/// playlists are still worth airing. `apps/android`'s `AirUiState`.
public struct AirUiState: Equatable, Sendable {
    public let playlists: CatalogPlaylistPage?
    public let charts: [StationChart]

    public init(playlists: CatalogPlaylistPage?, charts: [StationChart]) {
        self.playlists = playlists
        self.charts = charts
    }

    public var groups: [PlaylistGroup] {
        Dictionary(grouping: playlists?.playlists ?? [], by: \.pluginId)
            .map { pluginId, list in
                PlaylistGroup(pluginId: pluginId, pluginName: list[0].pluginName, playlists: list.sorted { $0.name.lowercased() < $1.name.lowercased() })
            }
            .sorted { $0.pluginName.lowercased() < $1.pluginName.lowercased() }
    }

    public var sourceErrors: [CatalogSourceError] { playlists?.errors ?? [] }

    public var isEmpty: Bool { groups.isEmpty && charts.isEmpty }
}

/// The station refuses to air a playlist with nothing in it, so the button is not offered for one.
public func canAir(_ tracks: [CatalogTrack]) -> Bool { !tracks.isEmpty }

/// Which way round a chart is played. A countdown is the shape a chart show has on the radio, so it
/// leads and is the default; the other two are here because neither is wrong.
public let chartOrders: [PlayoutChartInputChartOrder] = [.countdown, .ranked, .unordered]

/// What distinguishes a chart from the others a plugin offers: where it is from and what it counts.
public func chartQualifiers(_ chart: StationChart) -> [String] {
    [chart.country, chart.genre].compactMap { nonBlank($0) }
}
