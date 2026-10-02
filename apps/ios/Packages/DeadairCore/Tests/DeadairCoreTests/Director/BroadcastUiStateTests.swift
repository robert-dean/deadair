@testable import DeadairCore
import DeadairSdk
import Testing

/// What the broadcast says about itself. The case worth pinning is the one in the middle: a
/// broadcast that named nobody is presented by whoever the station has on air, and before that list
/// arrives the honest answer is that there is no name yet rather than that there is nobody.
/// `apps/android`'s `BroadcastUiStateTest`.
struct BroadcastUiStateTests {
    @Test func anEmptyNameIsNoTitleWhichIsWhatTheStationAnswersOffAir() {
        #expect(BroadcastUiState(order: stationOrder(name: "", items: []), personas: []).title == nil)
        #expect(BroadcastUiState(order: stationOrder(), personas: []).title == "Heavy metal hits")
    }

    @Test func aBlankBriefIsNoBrief() {
        #expect(BroadcastUiState(order: stationOrder(brief: "  "), personas: []).brief == nil)
        #expect(BroadcastUiState(order: stationOrder(brief: "warm and unhurried"), personas: []).brief == "warm and unhurried")
    }

    @Test func theHostIsTheOneTheBroadcastNamed() {
        let ui = BroadcastUiState(order: stationOrder(personaId: "a", personaLabel: "Cass"), personas: [persona("b", "Ash", defaultHost: true)])

        #expect(ui.host == .named("Cass"))
        #expect(ui.hostName == .text("Cass"))
    }

    @Test func theHostIsNamedByWhatTheyAreCalledOnAirNotByTheirCharacterSheet() {
        let personas = [persona("a", "Valley girl (eighties)", djName: "Tiffani"), persona("b", "Ash", defaultHost: true, djName: "Ash Moreno")]

        #expect(BroadcastUiState(order: stationOrder(personaId: "a", personaLabel: "Valley girl (eighties)"), personas: personas).hostName == .text("Tiffani"))
        #expect(BroadcastUiState(order: stationOrder(), personas: personas).hostName == .text("Ash Moreno"))
    }

    @Test func beforeThePersonaListArrivesANamedHostIsCalledByTheLabelTheOrderCarries() {
        #expect(BroadcastUiState(order: stationOrder(personaId: "a", personaLabel: "Cass"), personas: nil).hostName == .text("Cass"))
    }

    @Test func aBroadcastThatNamedNobodyIsPresentedByTheStationsOwnHost() {
        let ui = BroadcastUiState(order: stationOrder(), personas: [persona("a", "Ash", defaultHost: true)])

        #expect(ui.host == .stationsOwn("Ash"))
        #expect(ui.hostName == .text("Ash"))
    }

    @Test func beforeThePersonaListArrivesThereIsNoNameWhichIsNotTheSameAsNobody() {
        let ui = BroadcastUiState(order: stationOrder(), personas: nil)

        #expect(ui.host == .stationsOwn(nil))
        #expect(ui.hostName == .stationsHost)
    }

    @Test func nobodyWhenTheStationHasNobodyOnAirEither() {
        let ui = BroadcastUiState(order: stationOrder(), personas: [persona("a", "Ash")])

        #expect(ui.host == .nobody)
        #expect(ui.hostName == .noHost)
    }

    @Test func nothingOnAirCannotBeRecastAndTheStationSaysSoWithAnEmptyName() {
        #expect(!BroadcastUiState(order: stationOrder(name: "", items: []), personas: []).canRecast)
        #expect(BroadcastUiState(order: stationOrder(), personas: []).canRecast)
    }

    @Test func aBroadcastThatHasRunOutOfRecordsIsStillABroadcast() {
        // Between programmes the station answers with the name, the brief and the host it still
        // has, and an empty list. That is the moment an operator most wants to change either.
        let ui = BroadcastUiState(order: stationOrder(brief: "warm and unhurried", items: []), personas: [])

        #expect(ui.canRecast)
        #expect(!ui.nothingOn)
        #expect(ui.title == "Heavy metal hits")
        #expect(ui.brief == "warm and unhurried")
    }
}
