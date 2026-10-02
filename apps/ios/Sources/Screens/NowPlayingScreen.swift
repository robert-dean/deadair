import DeadairCore
import DeadairSdk
import SwiftUI

/// What is on air, and the one button a listener needs.
struct NowPlayingScreen: View {
    @Environment(AppModel.self) private var model
    /// One operator command at a time: two skips in flight would take two records off air.
    @State private var busy = false
    @State private var cover = CoverPaletteReader()
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let ui = model.nowPlayingUi
        let reading = model.nowPlaying.state.latest
        let station = model.settings.settings.station
        // The transport reading, for the operator only. It is what says whether there is anything to
        // skip, and which record the cover is: the public reading names none.
        let transport = model.playout.state(signedIn: model.signedIn).status.map {
            TransportUiState(status: $0, air: model.playout.state(signedIn: model.signedIn).air, busy: busy)
        }

        ScrollView {
            VStack(spacing: 20) {
                if ui.stale {
                    Label("Can't reach the station. Showing what it said last.", systemImage: "wifi.exclamationmark")
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(.yellow.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
                }

                // The cover leads to the record's page, for a signed-in account, when the transport
                // reading can say which record it is.
                if let route = PageRoute.track(transport?.onAirTrackId) {
                    NavigationLink(value: route) {
                        ArtworkView(url: artworkURL(station: station, reading: reading?.value), loader: model.artwork)
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: 360)
                    .accessibilityLabel(Text("Open this record"))
                } else {
                    ArtworkView(url: artworkURL(station: station, reading: reading?.value), loader: model.artwork)
                        .frame(maxWidth: 360)
                }

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
                        // Room kept either side for the heart, so a title long enough to wrap does
                        // not push it off the screen, and the title stays centred.
                        .padding(.horizontal, model.isOperator ? 44 : 0)
                        // The operator's heart for the record on air, at the end of its title.
                        .overlay(alignment: .trailing) {
                            if model.isOperator, let id = transport?.onAirTrackId.flatMap(UUID.init(uuidString:)) {
                                LikeHeart(trackId: id)
                            }
                        }
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

                // Shuffle, play, Skip: the play button in the middle and one control either side of it
                // at the same distance, for the operator. There is no "previous": a station has no
                // going back.
                HStack(spacing: 40) {
                    if model.isOperator, let transport {
                        operatorControl("shuffle", label: String(localized: "Shuffle"), enabled: !busy && transport.skipEnabled) {
                            await model.orderActions.shuffle()
                        }
                    }
                    PlayButton(onAccent: cover.palette?.accent.map { Color(rgb: $0.onAccent) })
                    if model.isOperator, let transport {
                        operatorControl("forward.end.fill", label: String(localized: "Skip"), enabled: transport.skipEnabled) {
                            await model.transport.skip()
                        }
                    }
                }

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
        // The page wears the on-air cover's colours: its accent on the controls, its mesh behind them,
        // drifting while the station is on air (not while this phone plays, which left it standing
        // still for somebody listening elsewhere). The words keep the system's colours.
        .tint(cover.palette?.accent.map { Color(rgb: $0.accent) })
        .background {
            if let mesh = cover.palette?.mesh, !mesh.isEmpty {
                CoverMesh(colors: mesh, moving: reading?.value.onAir == true).opacity(colorScheme == .dark ? 0.55 : 0.45)
            }
        }
        .task(id: "\(artworkURL(station: station, reading: reading?.value)?.absoluteString ?? "")|\(colorScheme == .dark)") {
            await cover.read(artworkURL(station: station, reading: reading?.value), darkPage: colorScheme == .dark, loader: model.artwork)
        }
        .navigationTitle(reading?.value.station ?? model.settings.settings.stationName ?? "deadair")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { model.nowPlaying.retry() }
        .task { await model.nowPlaying.hold() }
        // The two-second transport poll runs while this screen is up and the account operates the
        // station, and stops a few seconds after either ends.
        .task(id: model.isOperator) {
            if model.isOperator { await model.playout.hold() }
        }
        .onChange(of: reading?.value.station) { _, name in
            if let name { model.settings.rename(name) }
        }
    }

}

extension NowPlayingScreen {
    /// One of the operator's controls beside the play button: it takes the one turn there is, and
    /// gives it back when the station has answered.
    private func operatorControl(_ symbol: String, label: String, enabled: Bool, action: @escaping @MainActor () async -> Void) -> some View {
        Button {
            guard !busy else { return }
            busy = true
            Task {
                await action()
                busy = false
            }
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 48, height: 48)
        }
        .disabled(!enabled)
        .accessibilityLabel(Text(label))
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
    /// What reads on the accent the button is filled with: black on a light cover colour, white on a dark one.
    var onAccent: Color?

    var body: some View {
        let listening = model.listening
        VStack(spacing: 8) {
            Button {
                listening.wantsToPlay ? listening.stop() : listening.play()
            } label: {
                Image(systemName: listening.wantsToPlay ? "stop.fill" : "play.fill")
                    .font(.system(size: 34))
                    .frame(width: 76, height: 76)
                    .foregroundStyle(onAccent ?? .white)
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

/// The heart on Now playing, for the record on air.
///
/// The rating is read once per record, when it goes on air, rather than polled: the operator is the
/// only one who changes it, and when they do it is here or on the record's page. A read that fails
/// leaves the heart empty rather than wrong, and pressing an empty heart likes the record, which is
/// what it would have done anyway. The heart shows the mark only once the station has taken it.
/// `apps/android`'s `rememberLike`.
struct LikeHeart: View {
    @Environment(AppModel.self) private var model
    let trackId: UUID
    @State private var rating: Rating?
    @State private var busy = false

    var body: some View {
        let liked = rating == .liked
        Button {
            guard !busy else { return }
            let mark = toggledLike(rating)
            busy = true
            Task {
                if await model.catalogActions.rateTrack(trackId, mark) { rating = mark }
                busy = false
            }
        } label: {
            Image(systemName: liked ? "heart.fill" : "heart")
                .font(.title3)
                .foregroundStyle(liked ? Color.accentColor : .secondary)
                .frame(width: 40, height: 40)
        }
        .buttonStyle(.borderless)
        .disabled(busy)
        .accessibilityLabel(liked ? Text("Stop liking this record") : Text("Like this record"))
        .task(id: trackId) {
            rating = nil
            let id = trackId
            rating = await model.read { try await $0.catalog.getTrack(id: id).rating }?.value
        }
    }
}
