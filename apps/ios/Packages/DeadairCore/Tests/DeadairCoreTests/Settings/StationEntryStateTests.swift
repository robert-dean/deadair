@testable import DeadairCore
import Testing

/// What the address field says back.
///
/// Tested because the wording is the part most likely to be wrong and the part hardest to check by
/// looking at a screenshot, and because "not encrypted" has to read as a note rather than as a
/// fault, given that a LAN station has no other option.
struct StationEntryStateTests {
    @Test func showsTheStationsNameOnceAnAddressHasAnswered() {
        let state = StationEntryState.from("https://radio.example.com", check: .reachable(stationName: "Static Between Stations"))

        #expect(state.confirmedName == "Static Between Stations")
        #expect(state.error == nil)
        #expect(state.supportingText == .answeredAs(name: "Static Between Stations"))
    }

    @Test func namesTheStatusWhenSomethingAnsweredAndWasNotAStation() {
        #expect(StationEntryState.from("https://example.com", check: .notAStation(status: 404)).error == .answeredStatus(404))
    }

    @Test func saysSomethingAnsweredEvenWhenThereWasNoStatusToName() {
        #expect(StationEntryState.from("https://example.com", check: .notAStation(status: nil)).error == .notAStation)
    }

    @Test func namesTheMissingFieldWhenTheStationIsRunningAnOlderApi() {
        // The fix is a deploy, not a different address, so the message has to say so.
        #expect(StationEntryState.from("https://radio.example.com", check: .incompatible(missing: "mounts")).error == .olderApi(missing: "mounts"))
    }

    @Test func stillExplainsAnUnknownShapeWhenItCannotNameTheField() {
        #expect(StationEntryState.from("https://radio.example.com", check: .incompatible(missing: nil)).error == .unknownShape)
    }

    @Test func tellsAListenerToCheckTheNetworkWhenNothingAnswered() {
        #expect(StationEntryState.from("https://nope.invalid", check: .unreachable(cause: "dns")).error == .couldNotReach)
    }

    @Test func namesAnUntrustedCertificateRatherThanSayingTheStationCouldNotBeReached() {
        #expect(StationEntryState.from("https://radio.example.com", check: .untrusted(cause: "untrusted")).error == .untrusted)
    }

    @Test func notesCleartextWithoutTreatingItAsAnError() {
        let state = StationEntryState.typing("http://192.168.1.20:8080")

        #expect(state.cleartext)
        #expect(state.error == nil)
        #expect(state.supportingText == .notEncrypted)
    }

    @Test func saysNothingAboutEncryptionForAnHttpsAddress() {
        let state = StationEntryState.typing("https://radio.example.com")

        #expect(!state.cleartext)
        #expect(state.supportingText == nil)
    }

    // MARK: Whether there is anything to check

    @Test func offersNothingToCheckWhileTheFieldReadsAsTheAddressAlreadyKept() {
        // Two taps to achieve nothing: Check, then Use, for an address that was already in use.
        #expect(!StationEntryState.typing("https://radio.example.com", stored: "https://radio.example.com").showsCheck)
    }

    @Test func offersACheckOnceTheAddressHasBeenEdited() {
        #expect(StationEntryState.typing("https://radio.example.com:8443", stored: "https://radio.example.com").showsCheck)
    }

    @Test func readsADifferentlyWrittenAddressAsTheSameOneWhenItParsesTheSame() {
        #expect(!StationEntryState.typing("https://radio.example.com/", stored: "https://radio.example.com").showsCheck)
        #expect(!StationEntryState.typing("radio.example.com", stored: "https://radio.example.com").showsCheck)
    }

    @Test func alwaysOffersACheckOnFirstRunWhenNothingIsKeptYet() {
        #expect(StationEntryState.typing("https://radio.example.com").showsCheck)
        #expect(StationEntryState.typing("not an address").showsCheck)
    }

    @Test func stopsOfferingACheckOnceTheAddressHasAnswered() {
        let answered = StationEntryState.from("https://radio.example.com:8443", check: .reachable(stationName: "Static"), stored: "https://radio.example.com")

        #expect(!answered.showsCheck)
        #expect(answered.stored == "https://radio.example.com")
    }

    @Test func keepsTheKeptAddressThroughTypingAndThroughAnAnswer() {
        let typed = StationEntryState.typing("https://other.example.com", stored: "https://radio.example.com")
        let refused = StationEntryState.from(typed.address, check: .notAStation(status: 404), stored: typed.stored)
        let invalid = StationEntryState.invalid("nope", stored: typed.stored)

        #expect(refused.stored == "https://radio.example.com")
        #expect(invalid.stored == "https://radio.example.com")
        #expect(invalid.error == .notAnAddress)
        #expect(refused.showsCheck)
    }

    @Test func typingAgainDropsAVerdictThatNoLongerAppliesToWhatIsInTheField() {
        let confirmed = StationEntryState.from("https://radio.example.com", check: .reachable(stationName: "Static"))

        let edited = StationEntryState.typing(confirmed.address + "x")

        #expect(edited.confirmedName == nil)
        #expect(edited.error == nil)
    }
}
