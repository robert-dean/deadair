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

    init() {
        let http = StationHttp(userAgent: StationHttp.bundleAgent)
        let settings = SettingsStore()
        let station = settings.settings.station
        let nowPlaying = NowPlayingRepository(station: station) { station in
            try await http.sdk(for: station).nowplaying.getNowPlaying()
        }
        let artwork = ArtworkLoader(session: http.session)
        self.http = http
        self.settings = settings
        self.nowPlaying = nowPlaying
        self.artwork = artwork
        session = SessionManager(storage: KeychainSessionStorage(), station: station) { station, headers in
            http.sdk(for: station, headers: headers)
        }
        listening = Listening(settings: settings, nowPlaying: nowPlaying, artwork: artwork, userAgent: http.userAgent)
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
            stale: state.isStale
        )
    }
}
