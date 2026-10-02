@testable import DeadairCore
import DeadairSdk
import Testing

/// Who a broadcast may be handed to, and what each of them is called. `apps/android`'s `HostChoicesTest`.
struct HostChoicesTests {
    @Test func aCallerIsNeverOfferedBecauseOneCanNeverBePutOnAir() {
        let choices = hostChoices([persona("a", "Cass"), persona("b", "Ringer", kind: .caller)], currentId: nil)
        #expect(choices.map(\.name) == ["Cass"])
    }

    @Test func anAbsentKindIsAHostWhichIsWhatMostStoredPersonasLeaveBlank() {
        #expect(hostChoices([persona("a", "Cass")], currentId: nil).count == 1)
        #expect(hostChoices([persona("a", "Cass", kind: .host)], currentId: nil).count == 1)
    }

    @Test func sortedByLabelWhateverItsCase() {
        let choices = hostChoices([persona("a", "zoe"), persona("b", "Ash"), persona("c", "cass")], currentId: nil)
        #expect(choices.map(\.name) == ["Ash", "cass", "zoe"])
    }

    @Test func marksTheOneTheStationHasOnAirAndTheOneAlreadyPresenting() {
        let choices = hostChoices([persona("a", "Ash", defaultHost: true), persona("b", "Cass")], currentId: "b")
        #expect(choices.first { $0.id == "a" }?.onAir == true)
        #expect(choices.first { $0.id == "b" }?.current == true)
        #expect(choices.first { $0.id == "a" }?.current == false)
    }

    @Test func theOnAirNameRidesAlongOnlyWhenItSaysSomethingTheLabelDoesNot() {
        let choices = hostChoices([persona("a", "Ash", djName: "Ash"), persona("b", "Cass", djName: "Cassie"), persona("c", "Ray", djName: " ")], currentId: nil)
        #expect(choices.first { $0.id == "a" }?.djName == nil)
        #expect(choices.first { $0.id == "b" }?.djName == "Cassie")
        #expect(choices.first { $0.id == "c" }?.djName == nil)
    }

    @Test func handingBackToTheStationsHostIsOfferedOnlyWhereTheBroadcastNamedSomebody() {
        #expect(!BroadcastUiState(order: stationOrder(), personas: []).stationsOwnEnabled)
        #expect(BroadcastUiState(order: stationOrder(personaId: "a", personaLabel: "Cass"), personas: []).stationsOwnEnabled)
    }

    @Test func thePickerIsOfferedTheStationsCharactersWithTheBroadcastsOwnMarked() {
        let ui = BroadcastUiState(order: stationOrder(personaId: "a", personaLabel: "Cass"), personas: [persona("a", "Cass"), persona("b", "Ash", defaultHost: true)])
        #expect(ui.hostChoiceList.map(\.name) == ["Ash", "Cass"])
        #expect(ui.hostChoiceList.first { $0.id == "a" }?.current == true)
        #expect(ui.stationsOwnName == "Ash")
    }
}
