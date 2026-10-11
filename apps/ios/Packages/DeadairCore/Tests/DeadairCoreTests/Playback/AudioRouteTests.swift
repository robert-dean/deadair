@testable import DeadairCore
import Testing

/// Where the sound is going, and which changes of it stop the station.
struct AudioRouteTests {
    private let speaker = AudioOutput(kind: .builtInSpeaker, name: "Speaker")
    private let receiver = AudioOutput(kind: .builtInReceiver, name: "Receiver")
    private let wired = AudioOutput(kind: .headphones, name: "Headphones")
    private let kitchen = AudioOutput(kind: .airPlay, name: "Kitchen")
    private let buds = AudioOutput(kind: .bluetooth, name: "Earbuds")

    @Test func namesAnAirPlaySpeaker() {
        #expect(playingOn([kitchen]) == "Kitchen")
    }

    @Test func namesABluetoothDevice() {
        #expect(playingOn([buds]) == "Earbuds")
    }

    @Test func saysNothingForThePhoneOrWhatIsPluggedIntoIt() {
        #expect(playingOn([speaker]) == nil)
        #expect(playingOn([receiver]) == nil)
        #expect(playingOn([wired]) == nil)
        #expect(playingOn([AudioOutput(kind: .usb, name: "Interface")]) == nil)
        #expect(playingOn([]) == nil)
    }

    @Test func namesTheFirstChosenOutputTheSystemLists() {
        #expect(playingOn([speaker, kitchen, AudioOutput(kind: .airPlay, name: "Bedroom")]) == "Kitchen")
    }

    @Test func aNamelessOutputIsNotWorthALine() {
        #expect(playingOn([AudioOutput(kind: .airPlay, name: "")]) == nil)
    }

    @Test func headphonesComingOutStop() {
        #expect(routeChangeStops(.outputGone, previous: [wired]))
    }

    @Test func anAirPlaySpeakerOrBluetoothDeviceGoingAwayStops() {
        #expect(routeChangeStops(.outputGone, previous: [kitchen]))
        #expect(routeChangeStops(.outputGone, previous: [buds]))
    }

    @Test func choosingAnAirPlaySpeakerDoesNotStop() {
        #expect(!routeChangeStops(.other, previous: [speaker]))
        #expect(!routeChangeStops(.other, previous: [wired]))
        #expect(!routeChangeStops(.other, previous: [buds]))
    }

    @Test func aLossFromThePhoneItselfDoesNotStop() {
        #expect(!routeChangeStops(.outputGone, previous: [speaker]))
    }

    @Test func aLossWithNoPreviousRouteStopsAsItAlwaysDid() {
        #expect(routeChangeStops(.outputGone, previous: []))
    }
}
