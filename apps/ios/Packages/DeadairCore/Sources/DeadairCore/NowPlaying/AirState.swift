import DeadairSdk

/// What the station answered, polled.
public typealias NowPlayingState = PollState<NowPlaying>

extension PollState where Value == NowPlaying {
    /// The state a screen draws: the poll's, with the record swapped for the one this listener is
    /// hearing.
    ///
    /// While this phone is playing, the poll runs a buffer ahead of the audio: it names the next
    /// record the moment the station commits it, and its playhead counts down the station's decoder
    /// rather than the listener's ears. Drawn raw, Now playing changed title seconds before the
    /// music did and before the lock screen did, and its bar reached the end of a record that was
    /// still playing. `aired` is `NowPlayingGate`'s released reading, already stamped for the ears,
    /// so it is what a screen shows while `playing`.
    ///
    /// Whether the station is ANSWERING stays the poll's to say: one failed request is still shown
    /// as one, over the record that is still playing. Stopped, or before the gate has released
    /// anything, the poll's reading is all there is. Android's `heard`, case for case.
    public func heard(_ aired: Reading<NowPlaying>?, playing: Bool) -> PollState<NowPlaying> {
        guard playing, let aired else { return self }
        switch self {
        case .answered: return .answered(aired)
        case .unreachable: return .unreachable(lastGood: aired)
        // The poll started over (a station change) and has not answered yet: whatever was
        // released belongs to the session before it.
        case .loading: return self
        }
    }
}

/// What to tell the listener the station is doing.
public enum AirState: Equatable, Sendable {
    /// A record is playing and this is it.
    case onAir(NowPlayingTrack)

    /// Connected, but nothing is coming through yet.
    ///
    /// Under `playout.airMode: audience` the station airs only while somebody is listening, so
    /// CONNECTING is what puts it on air: the lease is taken, the first record is fetched, the
    /// encoder starts. Those seconds are ordinary and this is what they are called. Showing them
    /// as an error, or as a spinner that looks stuck, would make the station's normal behaviour
    /// read as a fault.
    case warmingUp

    /// Nothing is playing and nothing is being asked to. On an audience-gated station, the usual state.
    case offAir

    /// The station is not answering. What is showing, if anything, is stale.
    case unreachable
}

/// What the station is doing, from its own answer and whether this app is asking for audio.
///
/// Both halves are needed. `onAir` alone cannot tell warming up from off air, because they are the
/// same answer, `onAir: false`, and what separates them is whether this listener is currently
/// asking the station for anything.
public func airState(_ state: NowPlayingState, playbackRequested: Bool) -> AirState {
    switch state {
    case .loading:
        return playbackRequested ? .warmingUp : .offAir
    case .unreachable:
        return .unreachable
    case .answered(let reading):
        let now = reading.value
        if now.onAir, let track = now.track { return .onAir(track) }
        // On air with no track is a shape the contract says will not happen. Treated as warming
        // up rather than trusted, because the alternative is showing a record that is not there.
        return playbackRequested ? .warmingUp : .offAir
    }
}
