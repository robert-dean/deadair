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
                    // The programme first, the way a station's own app leads with the show and its
                    // host. One line: a label over the record rather than something to read in full.
                    if let header = ui.header {
                        Text(header.words)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
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

                // Only while the station is playing: there is nothing to put to sleep otherwise.
                if model.listening.wantsToPlay {
                    SleepMenu(canWaitForRecord: reading.flatMap { Playhead.project($0.value.track, readAt: $0.readAt, now: .now) } != nil)
                }
            }
            .padding()
        }
        .navigationTitle(reading?.value.station ?? model.settings.settings.stationName ?? "deadair")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                // The station's own record of itself, for a signed-in account. Absent otherwise
                // rather than offered and refused: listening needs no account.
                if model.signedIn {
                    NavigationLink {
                        HistoryScreen()
                    } label: {
                        Label("Played", systemImage: "clock.arrow.circlepath")
                    }
                    NavigationLink {
                        WhatsOnScreen()
                    } label: {
                        Label("What's on", systemImage: "calendar")
                    }
                }
                NavigationLink {
                    SettingsScreen()
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }
            }
        }
        .refreshable { model.nowPlaying.retry() }
        .task { await model.nowPlaying.hold() }
        .onChange(of: reading?.value.station) { _, name in
            if let name { model.settings.rename(name) }
        }
    }

}

/// The cover for what is on air, through the station's own art route. Nothing off air: a cover
/// left over from the last record would say something is playing that is not.
func artworkURL(station: StationUrl?, reading: NowPlaying?) -> URL? {
    guard reading?.onAir == true else { return nil }
    return station?.artUrl(reading?.track?.artworkUrl).flatMap(URL.init(string:))
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

/// The sleep timer: a moon that opens the choices, and the countdown beside it while one is set.
///
/// "After this record" is offered only when the station can say how much of the record is left,
/// the rule the progress bar already keeps: a timer set against a guess would stop the station at
/// the wrong moment for somebody who is by then asleep.
struct SleepMenu: View {
    @Environment(AppModel.self) private var model
    let canWaitForRecord: Bool

    var body: some View {
        let timer = model.listening.sleepTimer
        Menu {
            ForEach(SleepTimer.choices, id: \.self) { minutes in
                Button(String(localized: "\(minutes) minutes")) { timer.arm(.minutes(minutes)) }
            }
            Button(String(localized: "After this record")) { timer.arm(.afterRecord) }
                .disabled(!canWaitForRecord)
            if timer.state != .off {
                Button(String(localized: "Turn off the timer"), role: .destructive) { timer.clear() }
            }
        } label: {
            // Ticks once a second, which only matters while a countdown is showing.
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                Label {
                    Text(timer.line(at: .now)?.words ?? String(localized: "Sleep timer"))
                } icon: {
                    Image(systemName: timer.state == .off ? "moon.zzz" : "moon.zzz.fill")
                }
                .font(.footnote)
            }
        }
        .accessibilityLabel(Text("Sleep timer"))
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
