import DeadairCore
import DeadairSdk
import SwiftUI

/// Every playlist and chart the station can put on air, from whichever plugins offer them.
///
/// A plugin that could not be asked is said beside the ones that answered, so one provider being down
/// costs only its own playlists. `apps/android`'s `AirSomethingScreen`.
struct AirSomethingScreen: View {
    @Environment(AppModel.self) private var model
    @State private var state: LoadState<AirUiState> = .loading
    @State private var attempt = 0

    var body: some View {
        DetailBody(state: state, notFound: .cantReachStation, retry: { attempt += 1 }) { ui in
            List {
                Section {
                    Text(String(localized: "Putting one of these on air replaces the running order and goes out to every listener."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if ui.isEmpty {
                    Text(String(localized: "No plugin offers a playlist or a chart.")).foregroundStyle(.secondary)
                }
                ForEach(ui.sourceErrors, id: \.pluginId) { error in
                    Text("\(error.pluginName): \(error.message)").font(.footnote).foregroundStyle(.orange)
                }
                ForEach(ui.groups, id: \.pluginId) { group in
                    Section(group.pluginName) {
                        ForEach(group.playlists, id: \.id) { playlist in
                            NavigationLink(value: PageRoute.playlist(pluginId: playlist.pluginId, playlistId: playlist.id, name: playlist.name)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(playlist.name)
                                    if let count = playlist.trackCount {
                                        Text(Message.trackCount(count).words).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                if !ui.charts.isEmpty {
                    Section(String(localized: "Charts")) {
                        ForEach(ui.charts, id: \.id) { chart in
                            NavigationLink(value: PageRoute.chart(id: chart.id, name: chart.name)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(chart.name)
                                    let qualifiers = chartQualifiers(chart)
                                    if !qualifiers.isEmpty {
                                        Text(qualifiers.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(String(localized: "Playlists"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: attempt) {
            if attempt > 0 { state = .loading }
            // The playlists may fail outright while the charts answer, which is the page showing charts.
            async let playlists = model.read { try await $0.playlists.listImportablePlaylists() }
            async let charts = model.read { try await $0.charts.listCharts().charts }
            let readCharts = await charts
            let readPlaylists = await playlists
            guard let readCharts else { return }
            switch readCharts {
            case .loaded(let list): state = .loaded(AirUiState(playlists: readPlaylists?.value, charts: list))
            case .failed(let status): state = .failed(status: status)
            case .loading: break
            }
        }
    }
}

/// One playlist: its tracks, whether to take calls, and the button, behind one confirmation.
struct PlaylistScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let pluginId: String
    let playlistId: String
    let name: String
    @State private var tracks: LoadState<[CatalogTrack]> = .loading
    @State private var callins = false
    @State private var confirming = false
    @State private var busy = false
    @State private var attempt = 0

    var body: some View {
        DetailBody(state: tracks, notFound: .playlistUnavailable, retry: { attempt += 1 }) { list in
            List {
                if !canAir(list) {
                    Text(String(localized: "This playlist has no tracks the station can play.")).foregroundStyle(.secondary)
                } else {
                    Section {
                        CallinsToggle(callins: $callins)
                        Button {
                            confirming = true
                        } label: {
                            if busy { ProgressView() } else { Text(String(localized: "Air this playlist")).frame(maxWidth: .infinity) }
                        }
                        .disabled(busy)
                    }
                }
                Section(Message.trackCount(list.count).words) {
                    ForEach(Array(list.enumerated()), id: \.offset) { _, track in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(track.title).lineLimit(1)
                            let line = [nonBlank(track.artists.joined(separator: ", ")), track.durationMs.map(clockOf)].compactMap { $0 }.joined(separator: " · ")
                            if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                        }
                    }
                }
            }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .airConfirmation(name, isPresented: $confirming) { air { await model.airActions.airPlaylist(pluginId: pluginId, playlistId: playlistId, callins: callins) } }
        .task(id: attempt) {
            if attempt > 0 { tracks = .loading }
            let pluginId = pluginId, playlistId = playlistId
            if let read = await model.read({ try await $0.playlists.getPlaylistTracks(pluginId: pluginId, playlistId: playlistId).tracks }) { tracks = read }
        }
    }

    /// One air at a time, and back to Manage once the station has taken it.
    private func air(_ action: @escaping @MainActor () async -> Bool) {
        guard !busy else { return }
        busy = true
        Task {
            let done = await action()
            busy = false
            if done { dismiss() }
        }
    }
}

/// A published chart: its records, ranked, which way round to play them, and the button.
struct ChartScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let chartId: String
    let name: String
    @State private var page: LoadState<ChartPage> = .loading
    @State private var order: PlayoutChartInputChartOrder = .countdown
    @State private var callins = false
    @State private var confirming = false
    @State private var busy = false
    @State private var attempt = 0

    var body: some View {
        DetailBody(state: page, notFound: .chartUnavailable, retry: { attempt += 1 }) { chart in
            List {
                if chart.records.isEmpty {
                    Text(String(localized: "Nothing in this edition.")).foregroundStyle(.secondary)
                } else {
                    Section(String(localized: "Which way round?")) {
                        // The explicit-closure setter, not the method passed straight in: see apps/ios/CLAUDE.md.
                        Picker(String(localized: "Which way round?"), selection: Binding(get: { order }, set: { order = $0 })) {
                            ForEach(chartOrders, id: \.self) { value in Text(Message.chartOrder(value).words).tag(value) }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                    Section {
                        CallinsToggle(callins: $callins)
                        Button {
                            confirming = true
                        } label: {
                            if busy { ProgressView() } else { Text(String(localized: "Air this chart")).frame(maxWidth: .infinity) }
                        }
                        .disabled(busy)
                    } footer: {
                        Text(String(localized: "Records the library has never held are fetched as they are needed, and air untrimmed until they have been measured."))
                    }
                }
                Section {
                    ForEach(chart.records, id: \.rank) { record in
                        HStack(spacing: 12) {
                            Text("\(record.rank)").font(.headline.monospacedDigit()).frame(width: 32, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(record.title).lineLimit(1)
                                let line = [record.artist] + [record.peak.map { Message.chartPeak($0).words }, record.weeksOn.map { Message.chartWeeks($0).words }].compactMap { $0 }
                                Text(line.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .airConfirmation(name, isPresented: $confirming) {
            guard !busy else { return }
            busy = true
            Task {
                let done = await model.airActions.airChart(chartId: chartId, order: order, callins: callins)
                busy = false
                if done { dismiss() }
            }
        }
        .task(id: attempt) {
            if attempt > 0 { page = .loading }
            let id = chartId
            if let read = await model.read({ try await $0.charts.readChart(id: id) }) { page = read }
        }
    }
}

/// Whether somebody phones in during the broadcast this screen puts on air. Off unless ticked, and
/// the programme's answer alone: the station has no setting behind it, so an unticked row, which sends
/// nothing, is no calls.
struct CallinsToggle: View {
    @Binding var callins: Bool

    var body: some View {
        Toggle(isOn: $callins) {
            VStack(alignment: .leading, spacing: 2) {
                Text(String(localized: "Take calls during this broadcast"))
                Text(String(localized: "A phone-in is written and spoken a turn at a time, so it lands minutes after it is asked for. A setlist or a feature takes none whatever this says."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

extension View {
    /// Asked once, because this is the one action on the phone that changes what every listener hears
    /// at a stroke rather than one record at a time. The console does not ask; a phone in a pocket has
    /// a stray press the console does not.
    func airConfirmation(_ what: String, isPresented: Binding<Bool>, onConfirm: @escaping () -> Void) -> some View {
        confirmationDialog(Message.airConfirm(what).words, isPresented: isPresented, titleVisibility: .visible) {
            Button(String(localized: "Air it"), role: .destructive, action: onConfirm)
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text(String(localized: "This replaces what every listener hears."))
        }
    }
}
