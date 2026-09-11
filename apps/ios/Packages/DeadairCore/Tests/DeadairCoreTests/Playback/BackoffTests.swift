@testable import DeadairCore
import Testing

/// How long the player waits before trying a failed stream again.
struct BackoffTests {
    @Test func doublesFromASecondUpToACeiling() {
        var backoff = Backoff()

        let waits = (0..<7).map { _ in backoff.next() }

        #expect(waits == [.seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(16), .seconds(30), .seconds(30)])
    }

    @Test func givesUpRatherThanRetryingForTheRestOfTheDay() {
        var backoff = Backoff()
        while backoff.next() != nil {}

        #expect(backoff.next() == nil)
    }

    @Test func startsFromASecondAgainOnceTheStreamHasPlayed() {
        var backoff = Backoff()
        for _ in 0..<4 { _ = backoff.next() }

        backoff.reset()

        #expect(backoff.next() == .seconds(1))
    }

    @Test func exhaustedFlipsExactlyWhenNextStartsAnsweringNil() {
        var backoff = Backoff()

        while !backoff.exhausted { #expect(backoff.next() != nil) }

        #expect(backoff.next() == nil)
        #expect(backoff.exhausted)
    }
}
