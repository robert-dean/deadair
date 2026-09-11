import DeadairCore
import DeadairSdk
import SwiftUI

/// What is on air, and the one button a listener needs.
struct NowPlayingScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let ui = model.nowPlayingUi
        let reading = model.nowPlaying.state.latest
        let station = model.settings.settings.station

        ScrollView {
            VStack(spacing: 20) {
                if ui.stale {
                    Label("Can't reach the station. Showing what it said last.", systemImage: "wifi.exclamationmark")
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(.yellow.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
                }

                ArtworkView(url: artworkURL(station: station, reading: reading?.value), loader: model.artwork)
                    .frame(maxWidth: 360)

                VStack(spacing: 6) {
                    Text(ui.title.words)
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.center)
                    if let subtitle = ui.subtitle {
                        Text(subtitle.words)
                            .font(ui.subtitleScrolls ? .body : .callout)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .lineLimit(ui.subtitleScrolls ? 1 : nil)
                    }
                    if let album = ui.album {
                        Text(album).font(.footnote).foregroundStyle(.tertiary).lineLimit(1)
                    }
                }
                .accessibilityElement(children: .combine)

                if let reading {
                    PlayheadBar(track: reading.value.track, readAt: reading.readAt)
                }

                PlayButton()

                VStack(spacing: 4) {
                    Text(ui.footer.words).font(.footnote).foregroundStyle(.secondary)
                    if let note = ui.fallbackNote {
                        Text(note.words).font(.footnote).foregroundStyle(.orange).multilineTextAlignment(.center)
                    }
                }
            }
            .padding()
        }
        .navigationTitle(reading?.value.station ?? model.settings.settings.stationName ?? "deadair")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            NavigationLink {
                SettingsScreen()
            } label: {
                Label("Settings", systemImage: "gearshape")
            }
        }
        .refreshable { model.nowPlaying.retry() }
        .task { await model.nowPlaying.hold() }
        .onChange(of: reading?.value.station) { _, name in
            if let name { model.settings.rename(name) }
        }
    }

    private func artworkURL(station: StationUrl?, reading: NowPlaying?) -> URL? {
        guard reading?.onAir == true else { return nil }
        return station?.artUrl(reading?.track?.artworkUrl).flatMap(URL.init(string:))
    }
}

/// Play, or stop. Never pause: a paused connection is still a listener.
struct PlayButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let listening = model.listening
        VStack(spacing: 8) {
            Button {
                listening.wantsToPlay ? listening.stop() : listening.play()
            } label: {
                Image(systemName: listening.wantsToPlay ? "stop.fill" : "play.fill")
                    .font(.system(size: 34))
                    .frame(width: 76, height: 76)
            }
            .buttonStyle(.borderedProminent)
            .clipShape(Circle())
            .accessibilityLabel(listening.wantsToPlay ? Text("Stop") : Text("Play"))

            if let words = listening.conductor.state.words {
                Text(words).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

/// How far through the record, when the station can say. Draws nothing when it cannot, rather
/// than a bar built from a guess.
struct PlayheadBar: View {
    let track: NowPlayingTrack?
    let readAt: ContinuousClock.Instant

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            if let head = Playhead.project(track, readAt: readAt, now: .now) {
                VStack(spacing: 4) {
                    ProgressView(value: head.fraction)
                    HStack {
                        Text(clockOf(head.elapsedMs))
                        Spacer()
                        Text(clockOf(head.durationMs))
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("\(clockOf(head.elapsedMs)) of \(clockOf(head.durationMs))"))
            }
        }
    }
}
