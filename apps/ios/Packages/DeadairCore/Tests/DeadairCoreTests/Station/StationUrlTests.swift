@testable import DeadairCore
import Testing

/// The address a listener types, and everything derived from it.
///
/// All of it is derivation rather than configuration, because one origin serves the console, the
/// API under `/api` and the mounts beside it. So a mistake here is not a wrong setting, it is every
/// address in the app being wrong at once.
struct StationUrlTests {
    @Test func assumesHttpsWhenNoSchemeIsTyped() {
        // The safer guess. A station on the public internet is https, and a listener on a LAN
        // types four more characters.
        #expect(station("radio.example.com").origin == "https://radio.example.com")
    }

    @Test func keepsHttpBecauseALanStationHasNoOtherOption() {
        #expect(station("http://192.168.1.20:8080").origin == "http://192.168.1.20:8080")
    }

    @Test func lowercasesTheSchemeAndNothingElse() {
        #expect(station("HTTPS://Radio.Example.com").origin == "https://Radio.Example.com")
    }

    @Test func dropsATrailingSlashSoNothingDownstreamBuildsADoubleOne() {
        #expect(station("https://radio.example.com/").origin == "https://radio.example.com")
        #expect(station("https://radio.example.com").apiBase == "https://radio.example.com/api")
    }

    @Test func keepsAPathBecauseAStationMayBeMountedUnderOne() {
        let mounted = station("https://example.com/radio/")

        #expect(mounted.origin == "https://example.com/radio")
        #expect(mounted.apiBase == "https://example.com/radio/api")
        #expect(mounted.mountUrl("/live.mp3") == "https://example.com/radio/live.mp3")
    }

    @Test func dropsAQueryAndFragmentSoPastingTheConsolesAddressBarWorks() {
        #expect(station("https://radio.example.com/desk?tab=queue#now").origin == "https://radio.example.com/desk")
        // A query straight after the host is not part of the host.
        #expect(station("https://radio.example.com?tab=queue").origin == "https://radio.example.com")
    }

    @Test func refusesWhatIsNotAnAddress() {
        #expect(throws: StationUrl.ParseError.empty) { try StationUrl.parse("").get() }
        #expect(throws: StationUrl.ParseError.empty) { try StationUrl.parse("   ").get() }
        #expect(throws: StationUrl.ParseError.notHttp) { try StationUrl.parse("ftp://radio.example.com").get() }
        #expect(throws: StationUrl.ParseError.empty) { try StationUrl.parse("https://").get() }
        #expect(throws: StationUrl.ParseError.malformed) { try StationUrl.parse("radio example com").get() }
    }

    @Test func buildsAMountUrlWhetherOrNotTheReportedPathHasALeadingSlash() {
        // `mounts[]` carries the slash, but an older station's `stream.mount` was text an operator typed.
        #expect(station().mountUrl("/live.mp3") == "https://radio.example.com/live.mp3")
        #expect(station().mountUrl("live.mp3") == "https://radio.example.com/live.mp3")
        #expect(station().mountURL("/live.m3u8")?.absoluteString == "https://radio.example.com/live.m3u8")
    }

    @Test func passesAnAbsoluteArtworkUrlThroughUntouched() {
        // Art nothing has cached yet is at the provider's own CDN, and prefixing that with the
        // station would produce an address on neither.
        let cdn = "https://i.scdn.co/image/ab67616d"
        #expect(station().artUrl(cdn) == cdn)
    }

    @Test func resolvesRelativeArtworkAgainstTheApiRootNotTheOrigin() {
        #expect(station().artUrl("art/abc") == "https://radio.example.com/api/art/abc")
        #expect(station().artUrl("/art/abc") == "https://radio.example.com/api/art/abc")
    }

    @Test func hasNoArtworkUrlForATrackWithNoArt() {
        #expect(station().artUrl(nil) == nil)
        #expect(station().artUrl("") == nil)
    }

    @Test func pointsTheSdkAtTheApiRoot() {
        #expect(station("http://192.168.1.20:8080/").apiBaseURL.absoluteString == "http://192.168.1.20:8080/api")
    }
}
