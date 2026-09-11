import DeadairSdk
import Foundation

/// The SDK's transport, wearing the app's one User-Agent on every request.
///
/// HLS listeners are counted per IP and agent, so an app that sends two agents is two listeners
/// and one that sends a library's default is whatever that library happens to say. The agent goes
/// on here, on the one transport every generated client shares, rather than in each caller's
/// headers: `apps/android` sent `okhttp/4.x` from its image loader for months because a new caller
/// did not know to add it. Overwritten rather than filled in, because the point is that there is one.
public struct AgentTransport: HTTPTransport {
    private let inner: any HTTPTransport
    private let userAgent: String

    public init(_ inner: any HTTPTransport, userAgent: String) {
        self.inner = inner
        self.userAgent = userAgent
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = request
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        return try await inner.send(request)
    }
}

/// The app's agent: its name and its marketing version, so a station's log can tell this client
/// apart and tell one release from another. Read from the bundle rather than written twice, because
/// a copy here would stay behind the first time the real one moved.
public func userAgent(version: String?) -> String {
    "deadair-ios/\(version ?? "0")"
}
