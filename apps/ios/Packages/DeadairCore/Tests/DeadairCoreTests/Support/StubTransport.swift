@testable import DeadairCore
import DeadairSdk
import Foundation

/// The SDK's one seam to the network, answered by a closure. What `MockEngine` is to the Android
/// tests: the generated client runs for real, and only the bytes are made up.
struct StubTransport: HTTPTransport {
    let respond: @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await respond(request)
    }

    /// Answers every request with one status, body and content type.
    static func answering(_ status: Int, _ body: String, contentType: String = "application/json") -> StubTransport {
        StubTransport { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": contentType])!
            return (Data(body.utf8), response)
        }
    }

    /// Fails every request the way `URLSession` would.
    static func failing(_ error: Error) -> StubTransport {
        StubTransport { _ in throw error }
    }
}


/// A client for one station, over a stub.
func sdk(for station: StationUrl, _ transport: StubTransport) -> Deadair {
    Deadair(config: SdkConfig(baseURL: station.apiBaseURL, transport: transport))
}

/// A station address a test knows is valid.
func station(_ text: String = "https://radio.example.com") -> StationUrl {
    try! StationUrl.parse(text).get()
}
