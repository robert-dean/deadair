@testable import DeadairCore
import Testing

/// What an install remembers, read back from text.
struct ListenerSettingsTests {
    @Test func readsBackWhatItWrote() {
        let settings = ListenerSettings(station: station("http://192.168.1.20:8080"), stationName: "Static", format: .hls)

        let read = ListenerSettings(stationText: settings.stationText, nameText: settings.stationName, formatText: settings.formatText)

        #expect(read == settings)
    }

    @Test func treatsAnAddressThatNoLongerParsesAsNoneSoTheAppGoesBackToSetup() {
        let read = ListenerSettings(stationText: "ftp://nope", nameText: "Static", formatText: "hls")

        #expect(read.station == nil)
        // A name without its station would title a screen for a station that is not there.
        #expect(read.stationName == nil)
        // The format is not the station's to lose.
        #expect(read.format == .hls)
    }

    @Test func readsAFormatThisBuildDoesNotKnowAsMp3() {
        #expect(ListenerSettings(stationText: nil, nameText: nil, formatText: "wav").format == .mp3)
    }

    @Test func startsWithNothingKept() {
        #expect(ListenerSettings(stationText: nil, nameText: nil, formatText: nil) == ListenerSettings())
    }
}
