@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// The running order's poll: its cadence, its persona list, and an action's answer standing in
/// until the next poll.
@MainActor
struct OrderRepositoryTests {
    private func loaded(_ state: OrderState) -> OrderReading? {
        if case .loaded(let reading, _) = state { return reading }
        return nil
    }

    @Test func pollsEveryFiveSecondsAndNamesTheHostFromTheFirstRead() async {
        let orders = Script<StationOrder>([.success(stationOrder())])
        let personas = Script<[Persona]>([.success([persona("a", "Ash", defaultHost: true)])])
        let sleeps = Sleeps()
        let repository = OrderRepository(sleep: sleeps.sleep, readOrder: { try await orders.next() }, readPersonas: { try await personas.next() })

        let lease = repository.subscribe()
        #expect(await eventually { loaded(repository.state(signedIn: true))?.personas?.first?.label == "Ash" })
        #expect(await eventually { sleeps.recorded == [.seconds(5)] })
        lease.release()
    }

    @Test func aFailedPersonaReadIsNotAFailedPollAndLeavesTheNamesUnknown() async {
        let orders = Script<StationOrder>([.success(stationOrder())])
        let personas = Script<[Persona]>([.failure(Refused())])
        let repository = OrderRepository(sleep: Sleeps().sleep, readOrder: { try await orders.next() }, readPersonas: { try await personas.next() })

        let lease = repository.subscribe()
        #expect(await eventually { loaded(repository.state(signedIn: true)) != nil })
        let reading = loaded(repository.state(signedIn: true))
        #expect(reading?.personas == nil)
        #expect(reading?.order.name == "Heavy metal hits")
        lease.release()
    }

    @Test func signedOutBeatsWhatThePollHolds() async {
        let orders = Script<StationOrder>([.success(stationOrder())])
        let repository = OrderRepository(sleep: Sleeps().sleep, readOrder: { try await orders.next() }, readPersonas: { [] })

        let lease = repository.subscribe()
        #expect(await eventually { loaded(repository.state(signedIn: true)) != nil })
        #expect(repository.state(signedIn: false) == .signedOut)
        lease.release()
    }

    @Test func anOrderNeverReadIsUnreachableRatherThanEmpty() async {
        let orders = Script<StationOrder>([.failure(Refused())])
        let repository = OrderRepository(sleep: Sleeps().sleep, readOrder: { try await orders.next() }, readPersonas: { [] })

        let lease = repository.subscribe()
        #expect(await eventually { repository.state(signedIn: true) == .unreachable })
        lease.release()
    }

    @Test func anAppliedOrderStandsUntilTheNextPollAnswers() async {
        let orders = Script<StationOrder>([.success(stationOrder(name: "Polled")), .success(stationOrder(name: "Polled again"))])
        let sleeps = Sleeps()
        let repository = OrderRepository(sleep: sleeps.sleep, readOrder: { try await orders.next() }, readPersonas: { [] })

        let lease = repository.subscribe()
        #expect(await eventually { loaded(repository.state(signedIn: true))?.order.name == "Polled" })

        repository.apply(stationOrder(name: "Answered"))
        #expect(loaded(repository.state(signedIn: true))?.order.name == "Answered")

        repository.retry()
        #expect(await eventually { loaded(repository.state(signedIn: true))?.order.name == "Polled again" })
        #expect(repository.applied == nil)
        lease.release()
    }
}
