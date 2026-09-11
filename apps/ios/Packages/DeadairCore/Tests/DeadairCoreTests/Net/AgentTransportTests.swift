@testable import DeadairCore
import DeadairSdk
import Testing

/// The one User-Agent, from the transport every generated client shares.
struct AgentTransportTests {
    @Test func putsTheAppsAgentOnEveryRequestTheSdkMakes() async throws {
        let fake = FakeStation { _ in .json(#"{"station":"S","onAir":false,"listeners":0,"mounts":[]}"#) }
        let transport = AgentTransport(fake.transport, userAgent: "deadair-ios/1.2.3")
        let sdk = Deadair(config: SdkConfig(baseURL: station().apiBaseURL, headers: { ["User-Agent": "a-caller's-own"] }, transport: transport))

        _ = try await sdk.nowplaying.getNowPlaying()

        // Overwritten rather than filled in: a caller that set its own would re-create the second
        // listener this exists to remove.
        #expect(fake.requests.map(\.userAgent) == ["deadair-ios/1.2.3"])
    }

    @Test func namesTheAppAndItsVersion() {
        #expect(userAgent(version: "0.1.0") == "deadair-ios/0.1.0")
    }
}
