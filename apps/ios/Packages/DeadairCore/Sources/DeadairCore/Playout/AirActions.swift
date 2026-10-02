import DeadairSdk
import Foundation

/// Putting something on air from the phone.
///
/// A broadcast action, not a preview: it replaces whatever was queued and goes out over the mount to
/// every listener. The station answers with what it produced, which goes on screen at once, and the
/// running order is asked to read again because it has just been rebuilt. `apps/android`'s `AirActions`.
@MainActor
public final class AirActions {
    private let actions: OperatorActions
    private let playout: PlayoutRepository
    private let order: OrderRepository

    public init(actions: OperatorActions, playout: PlayoutRepository, order: OrderRepository) {
        self.actions = actions
        self.playout = playout
        self.order = order
    }

    /// Put the station on air on a running order built from the operator's own words. It mints a
    /// broadcast and has the station programme it, so it answers with the AIR reading rather than a
    /// playout status, and the records arrive at the model's pace. What is playing finishes.
    @discardableResult
    public func goOnAir(_ input: PutOnAirInput) async -> Bool {
        guard let answer = await actions.run({ try await $0.director.putTheStationOnAir(body: input) }) else { return false }
        playout.applyAir(answer)
        playout.refetchSoon()
        order.refetchSoon()
        return true
    }

    /// `callins` is sent only when it is on: absent is no calls, with nothing station-wide behind it.
    @discardableResult
    public func airPlaylist(pluginId: String, playlistId: String, callins: Bool = false) async -> Bool {
        await air { try await $0.playout.playAPlaylist(body: PlayoutPlaylistInput(pluginId: pluginId, playlistId: playlistId, callins: callins ? true : nil)) }
    }

    @discardableResult
    public func airChart(chartId: String, order chartOrder: PlayoutChartInputChartOrder, callins: Bool = false) async -> Bool {
        await air { try await $0.playout.playAChart(body: PlayoutChartInput(chartId: chartId, chartOrder: chartOrder, callins: callins ? true : nil)) }
    }

    /// 422 is the station saying there is nothing it can play in what it was handed.
    private func air(_ action: @escaping @Sendable (Deadair) async throws -> PlayoutStatus) async -> Bool {
        guard let answer = await actions.run(expected: [422: .playlistEmpty], action) else { return false }
        playout.apply(answer)
        playout.refetchSoon()
        order.refetchSoon()
        return true
    }
}
