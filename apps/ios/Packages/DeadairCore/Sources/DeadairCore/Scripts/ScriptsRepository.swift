import DeadairSdk
import Foundation
import Observation

/// What the station has said, newest first, as the screen has it.
public enum ScriptsList: Equatable, Sendable {
    case signedOut
    case loading
    case unreachable
    case loaded(attempts: [ScriptAttempt], canLoadMore: Bool, loadingMore: Bool, stale: Bool)
}

/// What the station has said between the records, newest first.
///
/// `HistoryRepository`'s shape exactly (a polled head and a tail walked back by hand, merged by
/// id) because it is the same problem: a feed whose top moves every few minutes and whose past does
/// not. Thirty seconds rather than fifteen, because a break is written when it comes round and
/// there are fewer of them than there are records.
///
/// `replace` is for a rating: the write answers with the attempt as the station now has it, and that
/// row is swapped in at once rather than waiting for the next poll to agree. Only until the next
/// poll, which carries the rating anyway. `apps/android`'s `ScriptsRepository`.
@MainActor
@Observable
public final class ScriptsRepository {
    public static let schedule = PollSchedule(steady: .seconds(30), ceiling: .seconds(300))
    public static let page = 50

    /// The one break this list is narrowed to, or `nil` for everything the station has said.
    public let segmentId: String?

    public private(set) var tail: [ScriptAttempt] = []
    public private(set) var loadingMore = false
    public private(set) var replaced: [String: ScriptAttempt] = [:]

    @ObservationIgnored private var head: Poller<ScriptHistoryPage>!
    @ObservationIgnored private let fetch: @Sendable (ScriptHistoryQuery) async throws -> ScriptHistoryPage
    @ObservationIgnored private var tailStarted = false
    @ObservationIgnored private var tailCursor: String?

    public init(
        segmentId: String? = nil,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
        fetch: @escaping @Sendable (ScriptHistoryQuery) async throws -> ScriptHistoryPage
    ) {
        self.segmentId = segmentId
        self.fetch = fetch
        head = Poller(schedule: Self.schedule, sleep: sleep, now: now) { [weak self, segmentId] in
            let page = try await fetch(ScriptHistoryQuery(limit: ScriptsRepository.page, segmentId: segmentId))
            // A fresh page carries every rating, so nothing swapped in is newer than it.
            await self?.clearReplaced()
            return page
        }
    }

    public func list(signedIn: Bool) -> ScriptsList {
        guard signedIn else { return .signedOut }
        switch head.state {
        case .loading: return .loading
        case .unreachable(lastGood: nil): return .unreachable
        case .answered, .unreachable:
            let page = head.state.latest?.value
            return .loaded(
                attempts: merged(page?.attempts ?? [], tail).map { replaced[$0.id] ?? $0 },
                canLoadMore: (tailStarted ? tailCursor : page?.nextBefore) != nil,
                loadingMore: loadingMore,
                stale: head.state.isStale
            )
        }
    }

    public func subscribe() -> PollLease { head.subscribe() }

    /// Hold a lease for as long as the calling task runs.
    public func hold() async { await head.hold() }

    public func retry() { head.kick() }

    /// Put the attempt as the station now has it in place of the one on screen.
    public func replace(_ attempt: ScriptAttempt) {
        replaced[attempt.id] = attempt
    }

    /// Fetch the page behind what is showing. Does nothing while a fetch is running or at the end.
    public func loadMore() async {
        guard !loadingMore, let cursor = tailStarted ? tailCursor : head.state.latest?.value.nextBefore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await fetch(ScriptHistoryQuery(limit: Self.page, before: cursor, segmentId: segmentId))
            tail = merged(tail, page.attempts)
            tailStarted = true
            tailCursor = page.nextBefore
        } catch {
            // Kept as it was.
        }
    }

    private func clearReplaced() {
        replaced = [:]
    }

    private func merged(_ first: [ScriptAttempt], _ second: [ScriptAttempt]) -> [ScriptAttempt] {
        guard !second.isEmpty else { return first }
        var seen = Set(first.map(\.id))
        return first + second.filter { seen.insert($0.id).inserted }
    }
}
