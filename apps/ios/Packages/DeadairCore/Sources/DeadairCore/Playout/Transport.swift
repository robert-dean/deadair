import DeadairSdk
import Foundation

/// The transport, from a pocket.
///
/// Each action applies the station's answer to the screen at once and then asks again over the next
/// seconds, which is what the console does after every action and for the same reason: the answer to
/// "skip" is the status the instant after the skip, and the encoder catching up is a second or two
/// behind it. `apps/android`'s `Transport`.
@MainActor
public final class Transport {
    private let actions: OperatorActions
    private let playout: PlayoutRepository

    public init(actions: OperatorActions, playout: PlayoutRepository) {
        self.actions = actions
        self.playout = playout
    }

    public func skip() async {
        await status { try await $0.playout.skipTheCurrentItem() }
    }

    public func stop() async {
        await status { try await $0.playout.stopPlayout() }
    }

    /// 409 is not a fault: the station was never put on air, so there is nothing to resume.
    public func start() async {
        await status(expected: [409: .nothingToResume]) { try await $0.playout.startPlayout() }
    }

    /// `nil` minutes holds until released by hand.
    public func hold(minutes: Int?) async {
        await air { try await $0.director.holdTheStationAgainstTheSchedule(body: HoldStationInput(minutes: minutes)) }
    }

    public func release() async {
        await air { try await $0.director.releaseTheStationToTheSchedule() }
    }

    public func setAirMode(_ mode: AirMode) async {
        await air { try await $0.director.setTheAirMode(body: SetStationAirInput(airMode: mode)) }
    }

    private func status(expected: [Int: Notice] = [:], _ action: @escaping @Sendable (Deadair) async throws -> PlayoutStatus) async {
        if let answer = await actions.run(expected: expected, action) { playout.apply(answer) }
        playout.refetchSoon()
    }

    private func air(_ action: @escaping @Sendable (Deadair) async throws -> StationAir) async {
        if let answer = await actions.run(action) { playout.applyAir(answer) }
        playout.refetchSoon()
    }
}
