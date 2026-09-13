import DeadairCore
import DeadairSdk
import Foundation
import Observation

/// Everything the app holds, built once. No framework: the graph is five objects and a function,
/// which is what `apps/android` found for its own `AppGraph`.
@MainActor
@Observable
final class AppModel {
    let http: StationHttp
    let settings: SettingsStore
    let nowPlaying: NowPlayingRepository
    let session: SessionManager
    let listening: Listening
    let artwork: ArtworkLoader
    /// What the station has played, and what it is scheduled to do: the signed-in operator's reads.
    let history: HistoryRepository
    let schedule: ScheduleRepository

    @ObservationIgnored private var openPlay = OpenPlay()

    init() {
        let http = StationHttp(userAgent: StationHttp.bundleAgent)
        let settings = SettingsStore()
        let station = settings.settings.station
        let nowPlaying = NowPlayingRepository(station: station) { station in
            try await http.sdk(for: station).nowplaying.getNowPlaying()
        }
        let artwork = ArtworkLoader(session: http.session)
        let session = SessionManager(storage: KeychainSessionStorage(), station: station) { station, headers in
            http.sdk(for: station, headers: headers)
        }
        self.http = http
        self.settings = settings
        self.nowPlaying = nowPlaying
        self.artwork = artwork
        self.session = session
        listening = Listening(settings: settings, nowPlaying: nowPlaying, artwork: artwork, userAgent: http.userAgent)
        // Through the session, which refreshes and replays once on a 401, and throws rather than asks
        // when nobody is signed in: these screens are only offered to a signed-in account anyway.
        history = HistoryRepository { query in try await session.withSession { try await $0.history.readHistory(query: query) } }
        schedule = ScheduleRepository(
            readCurrent: { try await session.withSession { try await $0.schedule.readCurrentSlot() } },
            readSlots: { try await session.withSession { try await $0.schedule.listSchedule().slots } },
            readPersonas: { try await session.withSession { try await $0.personas.listPersonas().personas } }
        )
    }

    /// Ask an address whether it is a station, before it is kept.
    func probe(_ station: StationUrl) async -> StationCheck {
        await StationProbe { [http] in http.sdk(for: $0) }.check(station)
    }

    /// Keep a station that has answered. Everything that belonged to the old one goes: what was
    /// playing, the reading, and a session the new station did not issue.
    func keep(_ station: StationUrl, name: String) {
        listening.stationChanged()
        settings.keep(station, name: name)
        nowPlaying.point(at: station)
        session.point(at: station)
        history.reset()
        schedule.reset()
    }

    /// The app has opened: start the station if the listener asked for that. Answers yes once per
    /// process at most, so a root view appearing again does not start it again.
    func opened() {
        if openPlay.shouldPlay(settings.settings) { listening.play() }
    }

    /// Whether the account can read the station's own record of itself. A hint for what to offer,
    /// never a gate: the station decides every read.
    var signedIn: Bool {
        if case .signedIn = session.state { return true }
        return false
    }

    /// The Now playing screen's state, from the reading and the player together.
    var nowPlayingUi: NowPlayingUiState {
        let state = nowPlaying.state
        let reading = state.latest?.value
        // The format ASKED for, as Android shows it: the fallback note names it, and says MP3 is
        // what is playing instead, only while something is playing.
        return NowPlayingUiState(
            air: airState(state, playbackRequested: listening.wantsToPlay),
            listeners: reading?.listeners ?? 0,
            format: settings.settings.format,
            playing: listening.conductor.state == .playing,
            buffering: listening.conductor.state == .warmingUp,
            fellBackToMp3: listening.wantsToPlay && listening.choice?.fellBack == true,
            stale: state.isStale,
            show: reading?.show
        )
    }
}
