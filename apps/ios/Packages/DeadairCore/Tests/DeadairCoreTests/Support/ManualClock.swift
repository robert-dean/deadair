@testable import DeadairCore

/// A `Schedule` on a clock the test moves by hand: virtual time, as `runTest` gives the Android
/// tests and `FakeTimeProvider` the desktop's.
@MainActor
final class ManualClock {
    private var now: Duration = .zero
    private var nextId = 0
    private var pending: [(id: Int, at: Duration, run: @MainActor () -> Void)] = []

    var schedule: Schedule {
        { [unowned self] delay, run in
            nextId += 1
            let id = nextId
            pending.append((id, now + delay, run))
            return { [weak self] in self?.pending.removeAll { $0.id == id } }
        }
    }

    var scheduled: Int { pending.count }

    /// Move time on, running whatever falls due, earliest first.
    func advance(by duration: Duration) {
        let target = now + duration
        while let next = pending.filter({ $0.at <= target }).min(by: { $0.at < $1.at }) {
            pending.removeAll { $0.id == next.id }
            now = next.at
            next.run()
        }
        now = target
    }
}
