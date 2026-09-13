import DeadairSdk
import Foundation
import Observation

/// The list the Played screen draws.
public enum HistoryList: Equatable, Sendable {
    /// Not an error: the list is the station's to give a signed-in account, and a screen that read
    /// like a fault would be telling somebody who only listens that something is broken.
    case signedOut
    case loading
    case unreachable
    case loaded(entries: [HistoryEntry], canLoadMore: Bool, loadingMore: Bool, stale: Bool)
}

/// What the station has played, newest first.
///
/// **Two halves that move at different speeds.** The head is polled, because the top of this list
/// changes every few minutes and somebody who has just heard a record wants to see it named.
/// Everything behind the head is fetched once, when somebody scrolls to it, and then left alone: it
/// is history, and history does not change. Re-polling everything a listener had scrolled through
/// would be a page of fifty becoming four hundred rows re-fetched every fifteen seconds.
///
/// **The merge deduplicates.** Records air while somebody is scrolling, so the newest fifty shift
/// down and the row that was fiftieth is in the tail as well. Merging by id rather than by position
/// is what keeps that from showing the same record twice.
///
/// `apps/android`'s `HistoryRepository`, on the lease-driven `Poller` every reading here uses, so
/// nothing is asked while nobody is looking.
@MainActor
@Observable
public final class HistoryRepository {
    /// What the console polls the head of its own feed at, and only ever the head.
    public static let schedule = PollSchedule(steady: .seconds(15), ceiling: .seconds(300))
    /// A screenful and a bit, matching the server's own default.
    public static let page = 50

    public private(set) var tail: [HistoryEntry] = []
    public private(set) var loadingMore = false

    @ObservationIgnored private var head: Poller<HistoryPage>!
    @ObservationIgnored private let fetch: @Sendable (HistoryQuery) async throws -> HistoryPage
    /// Whether anything has been fetched behind the head, and where the next page starts if so.
    @ObservationIgnored private var tailStarted = false
    @ObservationIgnored private var tailCursor: String?
    /// Bumped by `reset`, so a page that lands after the list was thrown away is dropped.
    @ObservationIgnored private var generation = 0

    /// `fetch` is one page. A function rather than the SDK, for the reason every repository here
    /// takes one: what this type is FOR is the cadence and the merge, and neither needs a client.
    public init(
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
        fetch: @escaping @Sendable (HistoryQuery) async throws -> HistoryPage
    ) {
        self.fetch = fetch
        head = Poller(schedule: Self.schedule, sleep: sleep, now: now) {
            try await fetch(HistoryQuery(limit: HistoryRepository.page))
        }
    }

    /// The list, as the Played screen draws it. Signed out beats whatever the list holds.
    public func list(signedIn: Bool) -> HistoryList {
        guard signedIn else { return .signedOut }
        switch head.state {
        case .loading: return .loading
        case .unreachable(lastGood: nil): return .unreachable
        case .answered, .unreachable:
            let page = head.state.latest?.value
            return .loaded(
                entries: merged(page?.entries ?? [], tail),
                canLoadMore: (tailStarted ? tailCursor : page?.nextBefore) != nil,
                loadingMore: loadingMore,
                stale: head.state.isStale
            )
        }
    }

    public func subscribe() -> PollLease { head.subscribe() }

    /// Hold a lease for as long as the calling task runs.
    public func hold() async { await head.hold() }

    /// Ask for the head again now, and forget the backoff.
    public func retry() { head.kick() }

    /// Throw away the list, for a new session or a new station: somebody else's history is not a
    /// stale reading of this one.
    public func reset() {
        generation += 1
        head.restart()
        tail = []
        tailStarted = false
        tailCursor = nil
        loadingMore = false
    }

    /// Fetch the page behind what is showing.
    ///
    /// Does nothing when a fetch is already running or the list has been read to its end, so a
    /// screen may call it every time its last row appears. A failure leaves the list as it was:
    /// somebody who could not load more still has what they had.
    public func loadMore() async {
        guard !loadingMore, let cursor = tailStarted ? tailCursor : head.state.latest?.value.nextBefore else { return }
        let asked = generation
        loadingMore = true
        defer { if asked == generation { loadingMore = false } }
        do {
            let page = try await fetch(HistoryQuery(limit: Self.page, before: cursor))
            guard asked == generation else { return }
            tail = merged(tail, page.entries)
            tailStarted = true
            tailCursor = page.nextBefore
        } catch {
            // Kept as it was.
        }
    }

    /// The first list, then whatever of the second the first does not already carry.
    private func merged(_ first: [HistoryEntry], _ second: [HistoryEntry]) -> [HistoryEntry] {
        guard !second.isEmpty else { return first }
        var seen = Set(first.map(\.id))
        return first + second.filter { seen.insert($0.id).inserted }
    }
}
