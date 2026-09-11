import DeadairCore
import DeadairSdk
import Foundation
import Observation

/// Listening to the station: the player, what its phases mean, and what the lock screen says.
///
/// The decisions are `DeadairCore`'s (`PlaybackConductor`, `chooseMount`, `NowPlayingGate`), and
/// this type wires them to AVFoundation, the audio session and the system's now-playing display.
/// The rules it adds are the ones only an app can keep:
///
/// - **The poll runs while the listener wants audio**, through a lease of its own, so the lock
///   screen stays current with the screen off and nothing is asked once playback stops.
/// - **The item is rebuilt only when the mount choice changes.** A reading that arrives while
///   playing, with the same mount as before, touches the lock screen and nothing else.
/// - **An interruption stops and drops, and resumes only when iOS says to.** A call that lasts six
///   minutes would otherwise keep the station on air for an empty room.
/// - **A pending reconnect holds background time.** iOS suspends an app that has stopped producing
///   audio about thirty seconds after it leaves the screen; the backoff's first waits fit inside
///   that, and after it the lock-screen tile is what the listener presses.
@MainActor
@Observable
final class Listening {
    let conductor: PlaybackConductor
    /// The mount being played, and whether it is the format that was asked for.
    private(set) var choice: MountChoice?

    @ObservationIgnored private let player: StationPlayer
    @ObservationIgnored private let gate: NowPlayingGate
    @ObservationIgnored private let system: SystemNowPlaying
    @ObservationIgnored private let settings: SettingsStore
    @ObservationIgnored private let nowPlaying: NowPlayingRepository
    @ObservationIgnored private let artwork: ArtworkLoader
    @ObservationIgnored private var lease: PollLease?
    @ObservationIgnored private var audioObservers: [NSObjectProtocol] = []
    @ObservationIgnored private var resumeAfterInterruption = false
    @ObservationIgnored private var endBackgroundWork: (@MainActor () -> Void)?

    init(settings: SettingsStore, nowPlaying: NowPlayingRepository, artwork: ArtworkLoader, userAgent: String) {
        self.settings = settings
        self.nowPlaying = nowPlaying
        self.artwork = artwork
        conductor = PlaybackConductor()
        player = StationPlayer(userAgent: userAgent)
        system = SystemNowPlaying()
        gate = NowPlayingGate()

        gate.push = { [weak self] reading in self?.publish(reading) }
        player.onPhase = { [weak self] phase in self?.observed(phase) }
        player.onTitle = { [weak self] title in self?.gate.onTitle(title) }
        conductor.onRetryDue = { [weak self] in self?.retarget(force: true) }
        system.onPlay = { [weak self] in self?.play() }
        system.onStop = { [weak self] in self?.stop() }
        system.isPlaying = { [weak self] in self?.conductor.wantsToPlay ?? false }
        audioObservers = Platform.observeAudio { [weak self] event in self?.audio(event) }
        watchReadings()
    }

    var wantsToPlay: Bool { conductor.wantsToPlay }

    /// The listener pressed play.
    func play() {
        guard settings.settings.station != nil, !conductor.wantsToPlay else { return }
        resumeAfterInterruption = false
        conductor.requested()
        if lease == nil { lease = nowPlaying.subscribe() }
        Platform.activateAudio()
        retarget(force: true)
    }

    /// The listener pressed stop, or something they would count as stop happened.
    func stop() {
        conductor.released()
        player.stop()
        Platform.deactivateAudio()
        lease?.release()
        lease = nil
        choice = nil
        gate.cancel()
        releaseBackgroundTime()
        system.clear()
    }

    /// The app is pointed somewhere else. What was playing belonged to the old station.
    func stationChanged() {
        if conductor.wantsToPlay { stop() }
    }

    /// Point the player at the mount the station publishes for the chosen format, if that is not
    /// what it is already playing, or at all when `force` says a fresh item is wanted.
    private func retarget(force: Bool) {
        guard conductor.wantsToPlay, let station = settings.settings.station else { return }
        let mounts = nowPlaying.state.latest?.value.mounts ?? []
        let next = chooseMount(mounts, wanted: settings.settings.format)
        guard force || next != choice, let url = station.mountURL(next.path) else { return }
        choice = next
        // A fresh item arrives with nothing on it, so the next reading must reach the lock screen
        // even if nothing about it moved.
        gate.cancel()
        player.play(url)
    }

    private func observed(_ phase: PlayerPhase) {
        conductor.observed(phase)
        if conductor.retryIn != nil { holdBackgroundTime() } else { releaseBackgroundTime() }
        if conductor.state == .unreachable { system.clear() }
    }

    private func audio(_ event: Platform.AudioEvent) {
        switch event {
        case .interrupted:
            guard conductor.wantsToPlay else { return }
            stop()
            resumeAfterInterruption = true
        case .interruptionEnded(let shouldResume):
            if resumeAfterInterruption, shouldResume { play() }
            resumeAfterInterruption = false
        case .outputLost:
            // AVPlayer pauses on its own here, and a pause is the one state this app never leaves
            // a live mount in.
            if conductor.wantsToPlay { stop() }
        case .reset:
            player.rebuild()
            if conductor.wantsToPlay { conductor.observed(.failed) }
        }
    }

    /// Re-run whenever the reading or the format changes, for as long as this object lives.
    private func watchReadings() {
        withObservationTracking {
            _ = nowPlaying.state
            _ = settings.settings.format
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.readingChanged()
                self?.watchReadings()
            }
        }
    }

    private func readingChanged() {
        guard conductor.wantsToPlay else { return }
        retarget(force: false)
        gate.onPoll(nowPlaying.state.latest?.value, buffered: player.buffered)
    }

    private func publish(_ reading: NowPlaying?) {
        guard conductor.wantsToPlay, let station = settings.settings.station else { return }
        let name = reading?.station ?? settings.settings.stationName ?? station.origin
        let playing = conductor.state == .playing
        system.show(station: name, reading: reading, artwork: nil, playing: playing)
        guard let art = station.artUrl(reading?.track?.artworkUrl).flatMap(URL.init(string:)) else { return }
        Task {
            let image = await artwork.image(for: art)
            // Only if the record it belongs to is still the one showing.
            guard conductor.wantsToPlay, nowPlaying.state.latest?.value.track?.startedAt == reading?.track?.startedAt else { return }
            system.show(station: name, reading: reading, artwork: image, playing: conductor.state == .playing)
        }
    }

    private func holdBackgroundTime() {
        if endBackgroundWork == nil { endBackgroundWork = Platform.beginBackgroundWork("Reconnecting to the station") }
    }

    private func releaseBackgroundTime() {
        endBackgroundWork?()
        endBackgroundWork = nil
    }
}
