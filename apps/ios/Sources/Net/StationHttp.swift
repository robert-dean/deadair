import DeadairCore
import DeadairSdk
import Foundation

/// The app's one HTTP stack: every API call and every piece of artwork goes through `session`.
///
/// One session because the station counts an HLS listener per IP and User-Agent, so the agent has to
/// be the same on every request the app makes. It is set twice, deliberately: on the session, which
/// is what the artwork loader relies on, and by `AgentTransport` on every SDK request, which
/// overwrites whatever a caller set. The player cannot use a session at all and gets the same string
/// through `AVURLAssetHTTPUserAgentKey`.
final class StationHttp: Sendable {
    let userAgent: String
    let session: URLSession

    init(userAgent: String) {
        self.userAgent = userAgent
        let configuration = URLSessionConfiguration.default
        configuration.httpAdditionalHeaders = ["User-Agent": userAgent]
        // Fifteen seconds without a byte, which is what the other two apps allow a request: long
        // enough for a station waking up, short enough that "could not reach" arrives while
        // somebody is still looking at the screen.
        configuration.timeoutIntervalForRequest = 15
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    /// A client for one station, carrying whatever headers it is handed on every request.
    func sdk(for station: StationUrl, headers: @escaping @Sendable () async throws -> [String: String] = { [:] }) -> Deadair {
        Deadair(config: SdkConfig(
            baseURL: station.apiBaseURL,
            headers: headers,
            transport: AgentTransport(URLSessionTransport(session: session), userAgent: userAgent)
        ))
    }

    /// The agent this build sends: the app's name and its marketing version from the bundle.
    static var bundleAgent: String {
        DeadairCore.userAgent(version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String)
    }
}
