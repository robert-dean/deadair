@testable import DeadairCore
import DeadairSdk
import Testing

/// What can be put on air. `apps/android`'s `AirUiStateTest`, case for case.
struct AirUiStateTests {
    private func playlist(_ plugin: String, _ name: String) -> CatalogPlaylist {
        CatalogPlaylist(pluginId: plugin, pluginName: plugin.prefix(1).uppercased() + plugin.dropFirst(), id: "\(plugin)/\(name)", name: name)
    }

    @Test func groupsPlaylistsByPluginBothSortedByName() {
        let page = CatalogPlaylistPage(playlists: [playlist("spotify", "Zed"), playlist("navidrome", "Beta"), playlist("spotify", "alpha")], errors: [])
        let groups = AirUiState(playlists: page, charts: []).groups
        #expect(groups.map(\.pluginName) == ["Navidrome", "Spotify"])
        #expect(groups[1].playlists.map(\.name) == ["alpha", "Zed"])
    }

    @Test func aPluginThatCouldNotBeAskedIsReportedBesideTheOnesThatAnswered() {
        let page = CatalogPlaylistPage(playlists: [playlist("navidrome", "Beta")], errors: [CatalogSourceError(pluginId: "spotify", pluginName: "Spotify", message: "token expired")])
        let ui = AirUiState(playlists: page, charts: [])
        #expect(ui.groups.count == 1)
        #expect(ui.sourceErrors.first?.message == "token expired")
        #expect(!ui.isEmpty)
    }

    @Test func isEmptyOnlyWithNoPlaylistsAndNoCharts() {
        #expect(AirUiState(playlists: nil, charts: []).isEmpty)
        #expect(!AirUiState(playlists: nil, charts: [StationChart(id: "c", pluginId: "p", name: "Top 40")]).isEmpty)
    }

    @Test func aPlaylistWithNothingInItCannotBeAired() {
        #expect(!canAir([]))
        #expect(canAir([CatalogTrack(id: "t", title: "x", artists: [])]))
    }

    @Test func countdownLeadsTheChartOrders() {
        #expect(chartOrders.first == .countdown)
        #expect(chartOrders.count == 3)
    }

    @Test func aChartsQualifiersAreWhereItIsFromAndWhatItCounts() {
        #expect(chartQualifiers(StationChart(id: "c", pluginId: "p", name: "n", country: "GB", genre: "rock")) == ["GB", "rock"])
        #expect(chartQualifiers(StationChart(id: "c", pluginId: "p", name: "n", country: " ")) == [])
    }
}
