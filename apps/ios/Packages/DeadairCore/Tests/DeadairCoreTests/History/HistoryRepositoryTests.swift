@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// What the Played screen reads: a polled head, a tail fetched by hand, and the merge between them.
@MainActor
struct HistoryRepositoryTests {
    private func entry(_ id: String) -> HistoryEntry {
        HistoryEntry(id: id, airedAt: Date(timeIntervalSince1970: 1_789_041_600), title: "Record \(id)", artists: "Someone")
    }

    private func page(_ ids: [String], next: String? = nil) -> HistoryPage {
        HistoryPage(entries: ids.map(entry), nextBefore: next)
    }

    /// Asked pages, in order, and the answers to give them.
    final class Pages: @unchecked Sendable {
        private let lock = NSLock()
        private var answers: [Result<HistoryPage, Error>]
        private var asked: [HistoryQuery] = []

        init(_ answers: [Result<HistoryPage, Error>]) { self.answers = answers }

        var queries: [HistoryQuery] { lock.withLock { asked } }

        func fetch(_ query: HistoryQuery) async throws -> HistoryPage {
            let answer: Result<HistoryPage, Error>? = lock.withLock {
                asked.append(query)
                return answers.isEmpty ? nil : answers.removeFirst()
            }
            if let answer { return try answer.get() }
            try await Task.sleep(for: .seconds(3600))
            throw CancellationError()
        }
    }

    private func repository(_ pages: Pages, sleeps: Sleeps = Sleeps()) -> HistoryRepository {
        HistoryRepository(sleep: sleeps.sleep) { try await pages.fetch($0) }
    }

    private func entries(_ list: HistoryList) -> [String] {
        if case .loaded(let entries, _, _, _) = list { return entries.map(\.id) }
        return []
    }

    private func canLoadMore(_ list: HistoryList) -> Bool {
        if case .loaded(_, let more, _, _) = list { return more }
        return false
    }

    @Test func pollsTheHeadEveryFifteenSecondsAndAsksForAPageAtATime() async {
        let pages = Pages([.success(page(["a"]))])
        let sleeps = Sleeps()
        let history = repository(pages, sleeps: sleeps)

        let lease = history.subscribe()
        #expect(await eventually { entries(history.list(signedIn: true)) == ["a"] })
        #expect(await eventually { sleeps.recorded == [.seconds(15)] })
        #expect(pages.queries.first == HistoryQuery(limit: 50))
        lease.release()
    }

    @Test func saysThereIsMoreOnlyWhileTheStationSaysSo() async {
        let pages = Pages([.success(page(["a"], next: "c1"))])
        let history = repository(pages)
        let lease = history.subscribe()
        #expect(await eventually { canLoadMore(history.list(signedIn: true)) })

        let ended = Pages([.success(page(["a"]))])
        let other = repository(ended)
        let otherLease = other.subscribe()
        #expect(await eventually { entries(other.list(signedIn: true)) == ["a"] })
        #expect(!canLoadMore(other.list(signedIn: true)))

        lease.release()
        otherLease.release()
    }

    @Test func walksBackFromTheCursorTheStationGaveIt() async {
        let pages = Pages([.success(page(["a", "b"], next: "c1")), .success(page(["c", "d"], next: "c2")), .success(page(["e"]))])
        let history = repository(pages)
        let lease = history.subscribe()
        #expect(await eventually { canLoadMore(history.list(signedIn: true)) })

        await history.loadMore()
        await history.loadMore()

        #expect(pages.queries.map(\.before) == [nil, "c1", "c2"])
        #expect(entries(history.list(signedIn: true)) == ["a", "b", "c", "d", "e"])
        #expect(!canLoadMore(history.list(signedIn: true)))
        lease.release()
    }

    @Test func showsNoRecordTwiceWhenTheHeadHasMovedUnderTheReader() async {
        // "b" was the head's last row when the tail was fetched, and the tail starts with it too.
        let pages = Pages([.success(page(["a", "b"], next: "c1")), .success(page(["b", "c"]))])
        let history = repository(pages)
        let lease = history.subscribe()
        #expect(await eventually { canLoadMore(history.list(signedIn: true)) })

        await history.loadMore()

        #expect(entries(history.list(signedIn: true)) == ["a", "b", "c"])
        lease.release()
    }

    @Test func doesNothingWhenThereIsNothingMoreToLoad() async {
        let pages = Pages([.success(page(["a"]))])
        let history = repository(pages)
        let lease = history.subscribe()
        #expect(await eventually { entries(history.list(signedIn: true)) == ["a"] })

        await history.loadMore()

        #expect(pages.queries.count == 1)
        lease.release()
    }

    @Test func keepsWhatItHadWhenLoadingMoreFails() async {
        let pages = Pages([.success(page(["a"], next: "c1")), .failure(Refused())])
        let history = repository(pages)
        let lease = history.subscribe()
        #expect(await eventually { canLoadMore(history.list(signedIn: true)) })

        await history.loadMore()

        #expect(entries(history.list(signedIn: true)) == ["a"])
        // Still offered: somebody who could not load more can try again.
        #expect(canLoadMore(history.list(signedIn: true)))
        lease.release()
    }

    @Test func dimsWhatItHasRatherThanBlankingItWhenTheHeadStopsAnswering() async {
        let pages = Pages([.success(page(["a"])), .failure(Refused())])
        let history = repository(pages)
        let lease = history.subscribe()
        #expect(await eventually { entries(history.list(signedIn: true)) == ["a"] })

        history.retry()

        #expect(await eventually { history.list(signedIn: true) == .loaded(entries: [entry("a")], canLoadMore: false, loadingMore: false, stale: true) })
        lease.release()
    }

    @Test func saysItCannotReachTheStationWhenNothingEverArrived() async {
        let history = repository(Pages([.failure(Refused())]))
        let lease = history.subscribe()

        #expect(await eventually { history.list(signedIn: true) == .unreachable })
        lease.release()
    }

    @Test func signedOutBeatsWhateverTheListHolds() async {
        let history = repository(Pages([.success(page(["a"]))]))
        let lease = history.subscribe()
        #expect(await eventually { entries(history.list(signedIn: true)) == ["a"] })

        #expect(history.list(signedIn: false) == .signedOut)
        lease.release()
    }

    @Test func throwsAwayATailThatBelongedToAnotherSession() async {
        let pages = Pages([.success(page(["a"], next: "c1")), .success(page(["b"])), .success(page(["z"]))])
        let history = repository(pages)
        let lease = history.subscribe()
        #expect(await eventually { canLoadMore(history.list(signedIn: true)) })
        await history.loadMore()
        #expect(entries(history.list(signedIn: true)) == ["a", "b"])

        history.reset()

        #expect(await eventually { entries(history.list(signedIn: true)) == ["z"] })
        lease.release()
    }
}
