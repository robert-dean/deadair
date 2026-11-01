@testable import DeadairCore
import Testing

/// When the operator's controls want unlocking again.
struct OperatorLockTests {
    private let start = ContinuousClock.now

    @Test func aNewProcessStartsShut() {
        #expect(!OperatorLock().isOpen)
    }

    @Test func unlockingOpensIt() {
        var lock = OperatorLock()

        lock.unlocked()

        #expect(lock.isOpen)
    }

    @Test func aShortTripAwayKeepsItOpen() {
        var lock = OperatorLock()
        lock.unlocked()

        lock.left(at: start)
        lock.returned(at: start.advanced(by: OperatorLock.grace - .seconds(1)))

        #expect(lock.isOpen)
    }

    @Test func awayForTheWholeGraceShutsIt() {
        var lock = OperatorLock()
        lock.unlocked()

        lock.left(at: start)
        lock.returned(at: start.advanced(by: OperatorLock.grace))

        #expect(!lock.isOpen)
    }

    @Test func leavingDoesNotShutItUntilTheAppIsBack() {
        var lock = OperatorLock()
        lock.unlocked()

        lock.left(at: start)

        #expect(lock.isOpen)
    }

    @Test func anUnlockWhileAwayStaysOpen() {
        var lock = OperatorLock()
        lock.left(at: start)

        lock.unlocked()
        lock.returned(at: start.advanced(by: OperatorLock.grace * 2))

        #expect(lock.isOpen)
    }

    @Test func eachTripIsTimedFromItsOwnStart() {
        var lock = OperatorLock()
        lock.unlocked()
        let almost = OperatorLock.grace - .seconds(1)

        lock.left(at: start)
        lock.returned(at: start.advanced(by: almost))
        lock.left(at: start.advanced(by: almost))
        lock.returned(at: start.advanced(by: almost * 2))

        #expect(lock.isOpen)
    }
}
