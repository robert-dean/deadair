@testable import DeadairCore
import Testing

/// The desktop's `StationLinkTests` and Android's `StationLinkTest`, case for case, so the three apps
/// read one link the same way.
struct StationLinkTests {
    private func origin(_ link: String?) -> String? { StationLink.parse(link)?.origin }

    @Test func readsTheStationTheConsoleWrites() {
        #expect(origin("deadair://connect?station=https%3A%2F%2Fradio.example.com") == "https://radio.example.com")
        #expect(origin("deadair://connect?station=http%3A%2F%2F192.168.1.50%3A8000") == "http://192.168.1.50:8000")
        #expect(origin("deadair://connect/?station=https%3A%2F%2Fradio.example.com") == "https://radio.example.com")
        #expect(origin("deadair://connect?from=console&station=https%3A%2F%2Fradio.example.com") == "https://radio.example.com")
        #expect(origin("deadair://connect?station=https%3A%2F%2Fradio.example.com&from=console") == "https://radio.example.com")
        #expect(origin("DEADAIR://connect?station=https%3A%2F%2Fradio.example.com") == "https://radio.example.com")
    }

    /// The only form that can name a plain-http station: the shorthand would make it https and point at nothing.
    @Test func keepsAPlainHttpStationPlain() {
        #expect(origin("deadair://connect?station=http%3A%2F%2Fradio.local") == "http://radio.local")
    }

    @Test func readsTheShorthandAsHttps() {
        #expect(origin("deadair://radio.example.com") == "https://radio.example.com")
        #expect(origin("deadair://radio.example.com/") == "https://radio.example.com")
        #expect(origin("deadair://radio.example.com:8443") == "https://radio.example.com:8443")
    }

    @Test func refusesAnythingElse() {
        for link: String? in [
            nil, "", "https://radio.example.com", "deadair://connect", "deadair://connect?station=", "deadair://connect?other=1",
            "deadair://connect?station=ftp%3A%2F%2Fradio.example.com", "deadair://radio.example.com/some/path",
            "deadair://radio.example.com?station=https%3A%2F%2Felsewhere.example.com", "not a link",
        ] {
            #expect(origin(link) == nil, "\(link ?? "nil")")
        }
    }

    @Test func aLinkNeverCarriesAWayIn() {
        #expect(origin("deadair://operator:secret@radio.example.com") == nil)
        #expect(origin("deadair://connect?station=https%3A%2F%2Foperator%3Asecret%40radio.example.com") == nil)
    }

    @Test func aBareHostInTheConnectFormIsNotGuessedAt() {
        #expect(origin("deadair://connect?station=radio.example.com") == nil)
    }

    @Test func aFragmentOnTheShorthandIsRefused() {
        #expect(origin("deadair://radio.example.com#x") == nil)
    }

    @Test func aLinkToAnotherStationIsAQuestion() {
        #expect(StationLink.proposal(station("https://elsewhere.example.com"), kept: station("https://radio.example.com"))?.origin == "https://elsewhere.example.com")
        #expect(StationLink.proposal(station("https://radio.example.com"), kept: nil)?.origin == "https://radio.example.com")
    }

    @Test func aLinkToTheStationAlreadyKeptIsNoQuestionAtAll() {
        #expect(StationLink.proposal(station("https://radio.example.com"), kept: station("https://radio.example.com/")) == nil)
    }
}
