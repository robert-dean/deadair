import DeadairCore
import DeadairSdk
import SwiftUI

/// What is on air, and the one button a listener needs. `apps/android`'s `NowPlayingScreen`.
///
/// Upright, the cover runs the width of the screen with its top and bottom dissolving into the page,
/// and under it the title, the credit, who is presenting, a hairline for the playhead and the row of
/// controls: one stack, centred, with set gaps inside it so the room left over goes above and below
/// the whole. The page wears the cover's colours as a mesh behind everything. Sideways, or on an iPad,
/// the cover sits beside the words instead.
///
/// No navigation bar, no listener count, no sleep timer (it is a row in Settings, as on Android) and
/// no stale banner: a stale cover is dimmed, and the title already says the station cannot be reached.
///
/// **Resting.** Left alone while a record is coming out of the phone, the tabs slide away after three
/// seconds and, after six, everything but the cover fades and the cover moves to the middle of the
/// screen. The first touch only wakes it, so a thumb landing where Stop was cannot stop the station on
/// its way to bringing Stop back. Never while VoiceOver is on: a faded control is still where it was,
/// with nothing on screen for a finger to find.
struct NowPlayingScreen: View {
    @Environment(AppModel.self) private var model
    /// One operator command at a time: two skips in flight would take two records off air.
    @State private var busy = false
    @State private var cover = CoverPaletteReader()
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    @State private var resting = false
    @State private var tabsAway = false
    /// Bumped by every touch; the timers start again from each one.
    @State private var touches = 0
    @State private var touching = false
    /// The page's height with the tabs showing, measured while they are.
    @State private var laidOutHeight: CGFloat = 0
    /// Where the cover's middle sits in the stack, measured before the resting move is applied.
    @State private var coverMiddle: CGFloat = 0
    /// The lyrics of the record this listener is hearing, read once per airing. See `readLyrics`.
    @State private var lyrics: NowPlayingLyrics?
    @State private var lyricsOpen = false

    var body: some View {
        let ui = model.nowPlayingUi
        let reading = model.heardState.latest
        let station = model.settings.settings.station
        let artwork = artworkURL(station: station, reading: reading?.value)
        // The transport reading, for the operator only. It is what says whether there is anything to
        // skip, and which record the cover is: the public reading names none.
        let transport = model.playout.state(signedIn: model.signedIn).status.map {
            TransportUiState(status: $0, air: model.playout.state(signedIn: model.signedIn).air, busy: busy)
        }
        let mesh = cover.palette?.mesh ?? []

        GeometryReader { geometry in
            let wide = geometry.size.width > geometry.size.height || geometry.size.width >= 600
            // The height the tabs leave, kept while they are away so the stack does not drop into
            // the room they give back.
            let height = tabsAway && laidOutHeight > 0 ? min(laidOutHeight, geometry.size.height) : geometry.size.height
            ZStack {
                if wide {
                    sideBySide(ui: ui, reading: reading, artwork: artwork, transport: transport, size: CGSize(width: geometry.size.width, height: height))
                } else {
                    fullBleed(ui: ui, reading: reading, artwork: artwork, transport: transport, size: CGSize(width: geometry.size.width, height: height))
                }

                // Resting, the first touch is the screen's: nothing under it sees it.
                if resting {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { touched() }
                        .accessibilityHidden(true)
                }
            }
            .frame(width: geometry.size.width, height: height)
            .frame(maxHeight: .infinity, alignment: .top)
            .onChange(of: geometry.size.height, initial: true) { _, measured in
                if !tabsAway { laidOutHeight = measured }
            }
        }
        .background {
            ZStack {
                Color(uiColor: .systemBackground)

                // The cover's colours as a slow mesh over the whole page, into the status bar and
                // through the tabs. It drifts while the station is airing something, whether or not
                // THIS phone is the one listening, and stands still off air, stale, or resting.
                if !mesh.isEmpty {
                    CoverMesh(colors: mesh, moving: reading?.value.onAir == true && !ui.stale && !resting)
                        .opacity(resting ? 0 : 0.8)
                    // Deeper under the words and the controls, whatever the cover: a bright cover's
                    // middle behind the title left the credit grey on grey.
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0.45),
                            .init(color: Color(uiColor: .systemBackground).opacity(0.5), location: 0.62),
                            .init(color: Color(uiColor: .systemBackground).opacity(0.7), location: 1),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .opacity(resting ? 0 : 1)
                }
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
        // Every touch starts the timers again, and is not taken from what it lands on: a tap on Play
        // while the tabs are away is a tap on Play, and brings them back as well.
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    if !touching {
                        touching = true
                        touched()
                    }
                }
                .onEnded { _ in touching = false }
        )
        // The page's accent goes on the controls only; the words keep the system's colours.
        .tint(cover.palette?.accent.map { Color(rgb: $0.accent) })
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(tabsAway ? .hidden : .visible, for: .tabBar)
        .task(id: "\(artwork?.absoluteString ?? "")|\(colorScheme == .dark)") {
            await cover.read(artwork, darkPage: colorScheme == .dark, loader: model.artwork)
        }
        .task(id: RestKey(touches: touches, tabs: model.tab == .nowPlaying && !voiceOver, rest: ui.canRest)) {
            await rest(canRest: ui.canRest)
        }
        .onDisappear {
            resting = false
            tabsAway = false
        }
        .task { await model.nowPlaying.hold() }
        // The two-second transport poll runs while this screen is up and the account operates the
        // station, and stops a few seconds after either ends.
        .task(id: model.isOperator) {
            if model.isOperator { await model.playout.hold() }
        }
        .onChange(of: reading?.value.station) { _, name in
            if let name { model.settings.rename(name) }
        }
        .task(id: LyricsKey(signedIn: model.signedIn, startedAt: reading?.value.track?.startedAt)) {
            await readLyrics(startedAt: reading?.value.track?.startedAt)
        }
        .sheet(isPresented: $lyricsOpen) {
            LyricsSheet(answer: lyrics)
        }
    }

    /// Whether there are words to offer for what this listener is hearing. The sheet works out which
    /// line is lit; the button needs only to know there is something to open.
    private var hasLyrics: Bool {
        LyricsUiState(answer: lyrics, heardStartedAt: model.heardState.latest?.value.track?.startedAt, playhead: nil) != .hidden
    }

    /// Read once per airing, keyed on the heard reading's `startedAt`, rather than polled: a record's
    /// words do not change while it airs. Signed out it asks nothing, because the route is a
    /// `platform.view` read; a read that fails leaves no button rather than an error over the cover.
    /// The old answer is kept while the new one is read, since `LyricsUiState` already refuses lyrics
    /// for another airing. `apps/android`'s `rememberLyrics`.
    private func readLyrics(startedAt: Int?) async {
        guard model.signedIn, startedAt != nil else {
            lyrics = nil
            return
        }
        lyrics = await model.read { try await $0.nowplaying.getNowPlayingLyrics() }?.value
    }

    /// What restarts the timers: a touch, or a change in whether they may run at all.
    private struct RestKey: Equatable {
        let touches: Int
        let tabs: Bool
        let rest: Bool
    }

    /// What a lyrics read depends on: whether the account may read them, and which airing is heard.
    private struct LyricsKey: Equatable {
        let signedIn: Bool
        let startedAt: Int?
    }

    /// The tabs away after three seconds untouched and, while a record is coming out of the phone and
    /// the screen is upright, the cover alone after six. Cancelled by the next touch.
    private func rest(canRest: Bool) async {
        guard model.tab == .nowPlaying, !voiceOver else { return }
        do {
            try await Task.sleep(for: .seconds(3))
            withAnimation(.easeInOut(duration: 0.3)) { tabsAway = true }
            guard canRest else { return }
            try await Task.sleep(for: .seconds(3))
            withAnimation(.easeInOut(duration: 0.9)) { resting = true }
        } catch {}
    }

    private func touched() {
        if resting || tabsAway {
            withAnimation(.easeOut(duration: 0.25)) {
                resting = false
                tabsAway = false
            }
        }
        touches += 1
    }

    // MARK: Upright

    private func fullBleed(ui: NowPlayingUiState, reading: Reading<NowPlaying>?, artwork: URL?, transport: TransportUiState?, size: CGSize) -> some View {
        // As wide as the screen allows, and no taller than leaves the words and the controls their
        // room: on a short phone the cover gives way, never the controls.
        let side = max(min(size.width, Self.artworkMaxWidth * 2, size.height - Self.belowCover - (hasLyrics ? Self.lyricsRoom : 0)), Self.minCover)

        return VStack(spacing: 0) {
            cover(ui: ui, artwork: artwork, transport: transport)
                .frame(width: side, height: side)
                // Both edges dissolve, made transparent rather than painted over, so the cover melts
                // into the colour behind it. Resting, the whole of it shows.
                .mask {
                    LinearGradient(
                        stops: [
                            .init(color: .black.opacity(resting ? 1 : 0), location: 0),
                            .init(color: .black, location: 0.12),
                            .init(color: .black, location: 0.55),
                            .init(color: .black.opacity(resting ? 1 : 0), location: 1),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
                .onGeometryChange(for: CGFloat.self, of: { $0.frame(in: .named(Self.page)).midY }) { middle in
                    // Measured where the cover sits in the stack, not where the resting move has taken it.
                    if !resting { coverMiddle = middle }
                }
                .offset(y: resting ? size.height / 2 - coverMiddle : 0)

            VStack(spacing: 0) {
                words(ui: ui, centred: true, transport: transport)
                    .padding(.top, Self.coverGap)
                controls(reading: reading, transport: transport)
            }
            .padding(.horizontal, Self.gutter)
            .opacity(resting ? 0 : 1)
        }
        .frame(width: size.width, height: size.height)
        .coordinateSpace(.named(Self.page))
    }

    // MARK: Sideways, or an iPad

    private func sideBySide(ui: NowPlayingUiState, reading: Reading<NowPlaying>?, artwork: URL?, transport: TransportUiState?, size: CGSize) -> some View {
        let height = size.height - 32
        return HStack(spacing: 24) {
            cover(ui: ui, artwork: artwork, transport: transport)
                // Bounded by the height as well as the width: a square sized off half a wide screen
                // is taller than the screen is.
                .frame(maxWidth: min(Self.artworkMaxWidth, max(height, Self.minCover)))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .frame(maxWidth: .infinity)
            VStack(spacing: 0) {
                words(ui: ui, centred: false, transport: transport)
                controls(reading: reading, transport: transport)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, Self.gutter)
        .padding(.vertical, 16)
        .frame(width: size.width, height: size.height)
    }

    // MARK: The pieces

    /// The cover, leading to the record's page for a signed-in account when the transport reading can
    /// say which record it is. Dimmed while the reading behind it is stale.
    @ViewBuilder
    private func cover(ui: NowPlayingUiState, artwork: URL?, transport: TransportUiState?) -> some View {
        let art = ArtworkView(url: artwork, loader: model.artwork, cornerRadius: 0, placeholderSize: 96)
            .opacity(ui.stale ? 0.4 : 1)
        if let route = PageRoute.track(transport?.onAirTrackId) {
            NavigationLink(value: route) { art }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Open this record"))
        } else {
            art
        }
    }

    private func words(ui: NowPlayingUiState, centred: Bool, transport: TransportUiState?) -> some View {
        let alignment: TextAlignment = centred ? .center : .leading
        let heart = model.isOperator ? transport?.onAirTrackId.flatMap(UUID.init(uuidString:)) : nil
        return VStack(alignment: centred ? .center : .leading, spacing: 2) {
            // The heart sits at the end of the title's line, because it is about the record rather
            // than about playing it. The title keeps a heart's width clear on BOTH sides, so it stays
            // centred and a long one wraps before it reaches the heart.
            Text(ui.title.words)
                .font(.largeTitle)
                .multilineTextAlignment(alignment)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, alignment: centred ? .center : .leading)
                .padding(.leading, model.isOperator && centred ? Self.heartRoom : 0)
                .padding(.trailing, model.isOperator ? Self.heartRoom : 0)
                .overlay(alignment: .trailing) {
                    if let heart { LikeHeart(trackId: heart) }
                }
            if let subtitle = ui.subtitle {
                // A credit stays on one line; a sentence of the app's own wraps, since cut short it
                // loses the half that says what to do.
                Text(subtitle.words)
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(alignment)
                    .lineLimit(ui.subtitleScrolls ? 1 : 2)
            }
            // Who is presenting, quieter than the credit and under it: the record is the news, the
            // host is who brought it.
            // Their picture beside the name when the station has one.
            if let host = ui.hostLine {
                HStack(spacing: 6) {
                    if let portrait = hostPortraitUrl(station: model.settings.settings.station, reading: model.heardState.latest?.value)
                        .flatMap(URL.init(string:)) {
                        HostPortrait(url: portrait, loader: model.artwork)
                    }
                    Text(host.words)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .padding(.top, 4)
            }
            // Beside the cover there is room for the album; under it, the title and the credit are the
            // whole of it, and the album is one tap away on the record's page.
            if !centred, let album = ui.album {
                Text(album).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: centred ? .center : .leading)
        .accessibilityElement(children: .combine)
    }

    private func controls(reading: Reading<NowPlaying>?, transport: TransportUiState?) -> some View {
        VStack(spacing: 0) {
            // Only when the station can say how long is left. A line drawn from a guess would be
            // worse than no line.
            if let reading {
                PlayheadLine(track: reading.value.track, readAt: reading.readAt)
                    .padding(.top, 20)
            }

            // Shuffle, play, Skip: the play button in the middle and one control either side of it at
            // the same distance. There is no "previous": a station has no going back.
            HStack(spacing: Self.playNeighbourGap) {
                if model.isOperator, let transport {
                    operatorControl("shuffle", label: String(localized: "Shuffle"), enabled: !busy && transport.skipEnabled) {
                        await model.orderActions.shuffle()
                    }
                }
                PlayButton(fill: cover.palette?.accent.map { Color(rgb: $0.accent) } ?? .accentColor, onAccent: cover.palette?.accent.map { Color(rgb: $0.onAccent) })
                if model.isOperator, let transport {
                    operatorControl("forward.end.fill", label: String(localized: "Skip"), enabled: transport.skipEnabled) {
                        await model.transport.skip()
                    }
                }
            }
            .padding(.top, 28)

            // Under the row rather than in it: the places either side of play are the operator's, and
            // a listener's button there would move the play button off centre for everyone else.
            if hasLyrics {
                Button {
                    lyricsOpen = true
                } label: {
                    Label("Lyrics", systemImage: "quote.bubble")
                        .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.borderless)
                .padding(.top, 12)
            }

            // Only when the player has something to say that the spinner does not: it is reconnecting,
            // or it has given up.
            if let words = model.listening.conductor.state.words, model.listening.conductor.state != .warmingUp {
                Text(words).font(.footnote).foregroundStyle(.secondary).padding(.top, 12)
            }
        }
    }

    /// The stack's own space, where the resting cover's move is measured.
    nonisolated private static let page = "nowPlaying.page"
    /// The room between the foot of the cover and the words under it.
    private static let coverGap: CGFloat = 16
    /// What the words, the line and the controls take under the cover, at most.
    private static let belowCover: CGFloat = 300
    /// What the Lyrics button takes under the controls, given back by the cover when there is one.
    private static let lyricsRoom: CGFloat = 44
    /// The smallest the cover gets on a short phone before the stack is allowed to crowd.
    private static let minCover: CGFloat = 180
    private static let artworkMaxWidth: CGFloat = 360
    private static let gutter: CGFloat = 16
    /// How far the controls either side of the play button stand from it.
    private static let playNeighbourGap: CGFloat = 48
    /// The room the title keeps clear either side, for the heart at its end.
    private static let heartRoom: CGFloat = 48
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
                .font(.system(size: 24, weight: .semibold))
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .disabled(!enabled)
        .accessibilityLabel(Text(label))
    }
}

/// The cover for what is on air, through the station's own art route, and during a break the picture
/// of whoever is talking when they have one (`coverArtUrl`). Nothing off air: a cover left over from
/// the last record would say something is playing that is not.
func artworkURL(station: StationUrl?, reading: NowPlaying?) -> URL? {
    coverArtUrl(station: station, reading: reading).flatMap(URL.init(string:))
}

/// The presenter's picture, small and round, beside their name.
///
/// Drawn only when the station sent one, so a presenter without a picture is the bare name exactly
/// as before. Through `ArtworkView`, for the reason every picture in the app goes through it: one
/// agent, one session.
struct HostPortrait: View {
    let url: URL
    let loader: ArtworkLoader
    var size: CGFloat = 24

    var body: some View {
        ArtworkView(url: url, loader: loader, cornerRadius: size / 2, placeholderSize: size * 0.45, placeholder: "person.fill")
            .frame(width: size, height: size)
    }
}

/// Play, or stop. Never pause: a paused connection is still a listener.
///
/// Drawn lit, as on Android: a gradient fill in the page's accent and a glow of its own colour under
/// it, because it is the one control everything else on the screen is arranged around. A spinner
/// takes the icon's place while the station warms up, and the name stays on the button.
struct PlayButton: View {
    @Environment(AppModel.self) private var model
    var fill: Color = .accentColor
    /// What reads on the accent the button is filled with: black on a light cover colour, white on a dark one.
    var onAccent: Color?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let listening = model.listening
        // The app's own green is pale in the dark and deep in the light, so what reads on it flips.
        let onAccent = onAccent ?? (colorScheme == .dark ? Color(white: 0.06) : .white)
        let warming = listening.conductor.state == .warmingUp
        Button {
            listening.wantsToPlay ? listening.stop() : listening.play()
        } label: {
            ZStack {
                Circle().fill(fill)
                Circle().fill(LinearGradient(colors: [.white.opacity(0.25), .clear], startPoint: .topLeading, endPoint: .bottomTrailing))
                if warming {
                    ProgressView().controlSize(.large).tint(onAccent)
                } else {
                    Image(systemName: listening.wantsToPlay ? "stop.fill" : "play.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(onAccent)
                }
            }
            .frame(width: 72, height: 72)
            .shadow(color: fill.opacity(0.6), radius: 14, y: 4)
        }
        .buttonStyle(.plain)
        // Named by what it stops: this phone, not the station. The station's own stop is on the desk
        // and is called Take off air.
        .accessibilityLabel(listening.wantsToPlay ? Text("Stop listening") : Text("Play"))
        .accessibilityValue(warming ? Text("Coming on air") : Text(verbatim: ""))
    }
}

/// Where the record has got to: a hairline with a dot on it rather than a bar, because nothing here
/// can be dragged and a slider's thick track promises that it can. Spoken as the numbers it is drawn
/// from. Draws nothing when the station cannot say, rather than a line built from a guess.
struct PlayheadLine: View {
    let track: NowPlayingTrack?
    let readAt: ContinuousClock.Instant

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            if let head = Playhead.project(track, readAt: readAt, now: .now) {
                GeometryReader { geometry in
                    let x = geometry.size.width * min(max(head.fraction, 0), 1)
                    ZStack(alignment: .leading) {
                        Capsule().fill(.primary.opacity(0.18)).frame(height: 2)
                        Capsule().fill(.tint).frame(width: x, height: 2)
                        Circle().fill(.tint).frame(width: 10, height: 10).offset(x: x - 5)
                    }
                    .frame(maxHeight: .infinity)
                    .animation(.linear(duration: 1), value: head.fraction)
                }
                .frame(height: 12)
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
                .font(.system(size: 24))
                .foregroundStyle(liked ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                .frame(width: 48, height: 48)
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
