@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

private func attempt(
    _ id: String = "a",
    outcome: ScriptOutcome = .written,
    script: String? = "Here is Metallica.",
    reason: String? = nil,
    rating: ScriptRating? = nil,
    writer: String = "model"
) -> ScriptAttempt {
    ScriptAttempt(id: id, at: Date(timeIntervalSince1970: 1_788_724_800), kind: "link", writer: writer, outcome: outcome, script: script, reason: reason, rating: rating)
}

/// How one attempt reads. `apps/android`'s `ScriptRowUiStateTest`, case for case.
struct ScriptRowUiStateTests {
    @Test func aDeclineIsStandbyNotAFault() {
        #expect(ScriptRowUiState(attempt()).tone == .ok)
        #expect(ScriptRowUiState(attempt(outcome: .declined, script: nil, reason: "nothing to say")).tone == .standby)
        #expect(ScriptRowUiState(attempt(outcome: .failed, script: nil, reason: "timeout")).tone == .fault)
    }

    @Test func theReasonTakesTheLineWhenThereAreNoWords() {
        let declined = ScriptRowUiState(attempt(outcome: .declined, script: nil, reason: "nothing to say"))
        #expect(declined.line == "nothing to say")
        #expect(declined.lineIsReason)
        #expect(!declined.rateable)

        let written = ScriptRowUiState(attempt())
        #expect(written.line == "Here is Metallica.")
        #expect(!written.lineIsReason)
        #expect(written.rateable)
    }

    @Test func anAbsentRatingStaysAbsentRatherThanBecomingNeutral() {
        #expect(ScriptRowUiState(attempt()).rating == nil)
        #expect(ScriptRowUiState(attempt(rating: .neutral)).rating == .neutral)
    }

    @Test func namesTheWriterForTheResolverToTranslate() {
        #expect(ScriptRowUiState(attempt(writer: "deterministic")).writer == .writer("deterministic"))
    }

    @Test func theFactsFollowTheConsolesOrderAndDropWhatIsAbsent() {
        var full = attempt(reason: "kept it short")
        full.personaKey = "cass"
        full.model = "gpt"
        full.durationMs = 1_250
        full.usage = ScriptUsage(outputTokens: 40, totalTokens: 120)
        full.previous = ScriptNeighbour(title: "One", artist: "A")
        full.next = ScriptNeighbour(title: "Two", artist: "B")
        let facts = ScriptRowUiState(full).facts

        #expect(facts.map(\.label) == [.kind, .host, .model, .took, .tokens, .after, .before, .note])
        #expect(facts.first { $0.label == .took }?.value == "1.3 s")
        #expect(facts.first { $0.label == .tokens }?.value == "120")
        #expect(facts.first { $0.label == .after }?.value == "One — A")
    }

    @Test func aReasonOnAnAttemptWithNoWordsIsTheLineNotANote() {
        let facts = ScriptRowUiState(attempt(outcome: .declined, script: nil, reason: "nothing to say")).facts
        #expect(facts.map(\.label) == [.kind])
    }
}

/// The feed of attempts: narrowed to one break when asked, and a rating's answer standing in until
/// the next poll.
@MainActor
struct ScriptsRepositoryTests {
    final class Pages: @unchecked Sendable {
        private let lock = NSLock()
        private var answers: [ScriptHistoryPage]
        private var asked: [ScriptHistoryQuery] = []

        init(_ answers: [ScriptHistoryPage]) { self.answers = answers }

        var queries: [ScriptHistoryQuery] { lock.withLock { asked } }

        func fetch(_ query: ScriptHistoryQuery) async throws -> ScriptHistoryPage {
            let answer: ScriptHistoryPage? = lock.withLock {
                asked.append(query)
                return answers.isEmpty ? nil : answers.removeFirst()
            }
            if let answer { return answer }
            try await Task.sleep(for: .seconds(3600))
            throw CancellationError()
        }
    }

    private func ids(_ list: ScriptsList) -> [String] {
        if case .loaded(let attempts, _, _, _) = list { return attempts.map(\.id) }
        return []
    }

    @Test func asksForOneBreakWhenNarrowedToItAndEveryThirtySeconds() async {
        let pages = Pages([ScriptHistoryPage(attempts: [attempt("a")])])
        let sleeps = Sleeps()
        let scripts = ScriptsRepository(segmentId: "seg-1", sleep: sleeps.sleep) { try await pages.fetch($0) }

        let lease = scripts.subscribe()
        #expect(await eventually { ids(scripts.list(signedIn: true)) == ["a"] })
        #expect(await eventually { sleeps.recorded == [.seconds(30)] })
        #expect(pages.queries.first?.segmentId == "seg-1")
        #expect(pages.queries.first?.limit == 50)
        lease.release()
    }

    @Test func aRatingsAnswerStandsInUntilTheNextPoll() async {
        let pages = Pages([ScriptHistoryPage(attempts: [attempt("a")]), ScriptHistoryPage(attempts: [attempt("a", rating: .disliked)])])
        let scripts = ScriptsRepository(sleep: Sleeps().sleep) { try await pages.fetch($0) }

        let lease = scripts.subscribe()
        #expect(await eventually { ids(scripts.list(signedIn: true)) == ["a"] })

        scripts.replace(attempt("a", rating: .liked))
        if case .loaded(let attempts, _, _, _) = scripts.list(signedIn: true) { #expect(attempts.first?.rating == .liked) }

        scripts.retry()
        #expect(await eventually {
            if case .loaded(let attempts, _, _, _) = scripts.list(signedIn: true) { return attempts.first?.rating == .disliked }
            return false
        })
        lease.release()
    }

    @Test func walksBackFromTheCursorAndMergesByID() async {
        let pages = Pages([
            ScriptHistoryPage(attempts: [attempt("a"), attempt("b")], nextBefore: "c1"),
            ScriptHistoryPage(attempts: [attempt("b"), attempt("c")]),
        ])
        let scripts = ScriptsRepository(sleep: Sleeps().sleep) { try await pages.fetch($0) }

        let lease = scripts.subscribe()
        #expect(await eventually { ids(scripts.list(signedIn: true)) == ["a", "b"] })
        await scripts.loadMore()
        #expect(ids(scripts.list(signedIn: true)) == ["a", "b", "c"])
        #expect(pages.queries.last?.before == "c1")
        lease.release()
    }
}
