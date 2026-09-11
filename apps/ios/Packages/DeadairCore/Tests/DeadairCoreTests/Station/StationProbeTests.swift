@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// Whether an address is a station, before the app agrees to remember it.
///
/// The outcomes are told apart on purpose. "Nothing answered" and "something answered and it was
/// not a station" are different mistakes, a wrong port against a wrong host, and a listener fixes
/// them differently, so collapsing them into one message would cost them the clue.
struct StationProbeTests {
    private func probe(_ transport: StubTransport) async -> StationCheck {
        await StationProbe { sdk(for: $0, transport) }.check(station())
    }

    @Test func namesTheStationWhenTheAddressAnswers() async {
        let result = await probe(.answering(200, #"{"station":"Static Between Stations","onAir":false,"listeners":0,"mounts":[]}"#))

        #expect(result == .reachable(stationName: "Static Between Stations"))
    }

    @Test func asksTheOnePublicRouteUnderTheApi() async {
        let asked = Locked<URL?>(nil)
        let transport = StubTransport { request in
            asked.set(request.url)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"station":"S","onAir":false,"listeners":0,"mounts":[]}"#.utf8), response)
        }

        _ = await probe(transport)

        #expect(asked.value?.absoluteString == "https://radio.example.com/api/nowplaying")
    }

    @Test func answersReachableForAQuietStationWhichIsNotAFault() async {
        // `/nowplaying` answers 200 with `onAir: false` rather than 404 precisely so a client does
        // not have to tell "off air" from "wrong address".
        let result = await probe(.answering(200, #"{"station":"Static","onAir":false,"listeners":0,"mounts":[{"format":"mp3","path":"/live.mp3"}]}"#))

        #expect(result == .reachable(stationName: "Static"))
    }

    @Test func reportsAStatusWhenSomethingAnswersThatIsNotAStation() async {
        #expect(await probe(.answering(404, "Not Found", contentType: "text/plain")) == .notAStation(status: 404))
    }

    @Test func reportsNotAStationWhenA200IsNotTheShape() async {
        // A router's admin page, or somebody else's web server. It answers 200 and HTML, so only
        // the decode tells the difference.
        #expect(await probe(.answering(200, "<html><body>hello</body></html>", contentType: "text/html")) == .notAStation(status: nil))
    }

    @Test func tellsAnOlderStationApartFromSomethingThatIsNotAStation() async {
        // What a station on an older build answers until it is redeployed: a real station whose
        // `/nowplaying` predates `mounts[]`.
        let result = await probe(.answering(200, #"{"station":"Static Between Stations","onAir":false,"listeners":0}"#))

        #expect(result == .incompatible(missing: "mounts"))
    }

    @Test func reportsUnreachableWhenNothingAnswersAtAll() async {
        let result = await probe(.failing(URLError(.cannotConnectToHost)))

        guard case .unreachable = result else {
            Issue.record("expected unreachable, got \(result)")
            return
        }
    }

    @Test func namesAnUntrustedCertificateRatherThanReportingItUnreachable() async {
        let result = await probe(.failing(URLError(.serverCertificateUntrusted)))

        guard case .untrusted = result else {
            Issue.record("expected untrusted, got \(result)")
            return
        }
    }

    @Test func findsAnUntrustedCertificateWrappedInsideAnotherFailure() async {
        // URLSession can report the certificate as the reason for a more general failure, so the
        // underlying-error chain is walked rather than the caught error alone tested.
        let underlying = NSError(domain: NSURLErrorDomain, code: NSURLErrorServerCertificateHasUnknownRoot)
        let wrapper = NSError(domain: NSURLErrorDomain, code: NSURLErrorSecureConnectionFailed, userInfo: [NSUnderlyingErrorKey: underlying])

        let result = await probe(.failing(wrapper))

        guard case .untrusted = result else {
            Issue.record("expected untrusted, got \(result)")
            return
        }
    }
}
