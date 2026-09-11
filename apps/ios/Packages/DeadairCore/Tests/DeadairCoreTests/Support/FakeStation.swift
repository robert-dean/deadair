@testable import DeadairCore
import DeadairSdk
import Foundation

/// A station that answers from a closure and remembers what it was asked. What the Android
/// session tests build over `MockEngine`: the generated client runs for real, bearer header and
/// form body included, and only the station is made up.
final class FakeStation: @unchecked Sendable {
    struct Request: Sendable {
        let path: String
        let authorization: String?
        let userAgent: String?
        let body: String
    }

    enum Answer: Sendable {
        case json(String, status: Int = 200)
        case empty(Int)
        /// A 401 naming what it refused, exactly as the token endpoint does.
        case refusal(String)
        case unreachable
    }

    private let lock = NSLock()
    private var seen: [Request] = []
    private let answer: @Sendable (Request) async -> Answer

    init(_ answer: @escaping @Sendable (Request) async -> Answer) {
        self.answer = answer
    }

    var requests: [Request] { lock.withLock { seen } }

    var transport: StubTransport {
        StubTransport { [self] urlRequest in
            let request = Request(
                path: urlRequest.url?.path() ?? "",
                authorization: urlRequest.value(forHTTPHeaderField: "Authorization"),
                userAgent: urlRequest.value(forHTTPHeaderField: "User-Agent"),
                body: urlRequest.httpBody.map { String(decoding: $0, as: UTF8.self) } ?? ""
            )
            lock.withLock { seen.append(request) }
            let url = urlRequest.url!
            switch await answer(request) {
            case .json(let body, let status):
                return (Data(body.utf8), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
            case .empty(let status):
                return (Data(), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!)
            case .refusal(let error):
                let headers = ["Content-Type": "application/json", "WWW-Authenticate": #"Bearer error="\#(error)", error_description="the station said so""#]
                return (Data(#"{"message":"Unauthorized"}"#.utf8), HTTPURLResponse(url: url, statusCode: 401, httpVersion: nil, headerFields: headers)!)
            case .unreachable:
                throw URLError(.cannotConnectToHost)
            }
        }
    }
}

/// Holds whoever arrives until `count` have, then lets them all through.
actor Barrier {
    private let count: Int
    private var waiting: [CheckedContinuation<Void, Never>] = []

    init(_ count: Int) {
        self.count = count
    }

    func arrive() async {
        if waiting.count + 1 >= count {
            waiting.forEach { $0.resume() }
            waiting.removeAll()
            return
        }
        await withCheckedContinuation { waiting.append($0) }
    }
}

enum Bodies {
    static func token(_ access: String, refresh: String? = "refresh-2") -> String {
        let refreshField = refresh.map { #","refresh_token":"\#($0)""# } ?? ""
        return #"{"result":"token","access_token":"\#(access)"\#(refreshField),"expires_in":2592000,"token_type":"Bearer","scope":"platform"}"#
    }

    static func session(_ roles: String...) -> String {
        #"{"actorId":"u-1","roles":[\#(roles.map { "\"\($0)\"" }.joined(separator: ","))]}"#
    }

    static let history = #"{"entries":[]}"#

    static let challenge = """
        {"result":"mfa_required","challenge_id":"c_1","expires_at":"2026-09-08T12:00:00Z",
         "factors":[{"method":"email","method_id":"email-1","kind":"possession"},
                    {"method":"authenticator","method_id":"totp-1","kind":"possession"}]}
        """
}

@MainActor
func manager(_ storage: MemorySessionStorage, station target: StationUrl? = station(), _ fake: FakeStation) -> SessionManager {
    SessionManager(storage: storage, station: target) { station, headers in
        Deadair(config: SdkConfig(baseURL: station.apiBaseURL, headers: headers, transport: fake.transport))
    }
}

func signedIn(access: String = "access-1", refresh: String = "refresh-1", roles: Set<PlatformRole> = []) -> StoredSession {
    StoredSession(origin: station().origin, email: "operator@example.com", accessToken: access, refreshToken: refresh, roles: roles)
}
