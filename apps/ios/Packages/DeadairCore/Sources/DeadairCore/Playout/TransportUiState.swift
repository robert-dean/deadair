import DeadairSdk
import Foundation

/// The operator's controls, as data: which are drawn, which are enabled. The console's rules,
/// carried over so a phone and a laptop never disagree about whether Skip is worth pressing.
/// `apps/android`'s `TransportUiState`.
public struct TransportUiState: Equatable, Sendable {
    public let status: PlayoutStatus
    public let air: StationAir?
    /// An action is in flight, so every control waits for it rather than queueing a second one.
    public let busy: Bool

    public init(status: PlayoutStatus, air: StationAir?, busy: Bool = false) {
        self.status = status
        self.air = air
        self.busy = busy
    }

    /// Nothing on air is nothing to cut, and a skip needs a stream to take it.
    public var skipEnabled: Bool { !busy && status.streamUp && status.nowPlaying != nil }

    /// A stood-down station shows Start where Stop would be. Unknown until the air reading arrives,
    /// and Stop until then.
    public var showsStart: Bool { air?.active == false }

    public var airMode: AirMode? { air?.airMode }

    /// The record on air, as the transport reading names it: the public reading names none.
    public var onAirTrackId: String? { status.nowPlaying?.item.trackId }
}
