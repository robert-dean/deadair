import Foundation

/// Answers handed out in order, then a request that never returns until it is cancelled: what a
/// test needs to step a poll loop one answer at a time.
final class Script<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var answers: [Result<Value, Error>]
    private var callCount = 0
    private var wasCancelled = false

    init(_ answers: [Result<Value, Error>]) {
        self.answers = answers
    }

    var calls: Int { lock.withLock { callCount } }
    var cancelled: Bool { lock.withLock { wasCancelled } }

    func next() async throws -> Value {
        let answer: Result<Value, Error>? = lock.withLock {
            callCount += 1
            return answers.isEmpty ? nil : answers.removeFirst()
        }
        if let answer { return try answer.get() }
        do {
            try await Task.sleep(for: .seconds(3600))
        } catch {
            lock.withLock { wasCancelled = true }
            throw error
        }
        throw CancellationError()
    }
}

/// A sleep that records what it was asked for and then waits until cancelled, so a poll loop
/// moves on only when a test kicks it. `immediately` lists the durations that return at once.
final class Sleeps: @unchecked Sendable {
    private let lock = NSLock()
    private var asked: [Duration] = []
    private let immediately: Set<Duration>

    init(immediately: Set<Duration> = []) {
        self.immediately = immediately
    }

    var recorded: [Duration] { lock.withLock { asked } }

    var sleep: @Sendable (Duration) async throws -> Void {
        { [self] duration in
            if immediately.contains(duration) { return }
            lock.withLock { asked.append(duration) }
            try await Task.sleep(for: .seconds(3600))
        }
    }
}

struct Refused: Error {}

/// Wait, briefly and for real, for something the code under test does on another task.
@MainActor
func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
    for _ in 0..<2000 {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(1))
    }
    return condition()
}
