import DeadairSdk
import Foundation

/// What asking an address whether it is a station got back.
public enum StationCheck: Equatable, Sendable {
    /// It answered, and this is what it calls itself.
    case reachable(stationName: String)

    /// A deadair station, answering a shape this app does not know.
    ///
    /// Told apart from `notAStation` because the two are fixed differently, and the wrong message
    /// sends somebody to check an address that was right all along. A JSON object missing a key
    /// the contract requires is what an older API looks like; a web page or a router's login form
    /// fails to parse as the contract at all and lands in the case below.
    case incompatible(missing: String?)

    /// Something is there and it is not a deadair station: a 404, a login page, a router's UI.
    case notAStation(status: Int?)

    /// Nothing answered: wrong host, wrong port, no network.
    case unreachable(cause: String?)

    /// Something answered, but this phone does not trust the certificate it presented.
    ///
    /// Told apart from `unreachable` because the fix is different: a self-signed or private-CA
    /// certificate is an ordinary thing for a self-hosted station to have, and the fix is
    /// installing and trusting that CA on the phone rather than checking the address.
    case untrusted(cause: String?)
}

/// Whether an address is a station, asked before the app agrees to remember it.
///
/// Through `/nowplaying` because it is the one deliberately public route: it needs no session, it
/// answers 200 on a quiet station rather than a 404, and it names the station, so one call both
/// proves the address and gives the listener something to recognise.
public struct StationProbe: Sendable {
    private let sdkFor: @Sendable (StationUrl) -> Deadair

    public init(sdkFor: @escaping @Sendable (StationUrl) -> Deadair) {
        self.sdkFor = sdkFor
    }

    public func check(_ station: StationUrl) async -> StationCheck {
        do {
            return .reachable(stationName: try await sdkFor(station).nowplaying.getNowPlaying().station)
        } catch {
            return Self.classify(error)
        }
    }

    /// The outcome for a failure, checked in the order that makes each branch true.
    static func classify(_ error: Error) -> StationCheck {
        // First, ahead of every other branch: URLSession may wrap a TLS failure in another error,
        // and the fix it needs is not the one any other message suggests.
        if let untrusted = untrustedCertificate(in: error as NSError) {
            return .untrusted(cause: untrusted.localizedDescription)
        }
        if let error = error as? SdkError {
            // No response at all.
            if error.status == 0 { return .unreachable(cause: error.message) }
            // A 2xx here means the body did not decode: the generated client wraps the decoder's
            // error in an `SdkError` that keeps the body but not the reason, so the body is
            // decoded again to find out which kind of wrong it is.
            if (200..<300).contains(error.status) { return decodeFailure(in: error.body) }
            // A status the contract does not describe. Something is listening on this address; it
            // is just not a station.
            return .notAStation(status: error.status)
        }
        if let error = error as? DecodingError { return decodeFailure(error) }
        return .unreachable(cause: error.localizedDescription)
    }

    private static func decodeFailure(in body: Data) -> StationCheck {
        do {
            _ = try SdkJSON.makeDecoder().decode(NowPlaying.self, from: body)
            // It decodes now, so the failure was something else about the response.
            return .notAStation(status: nil)
        } catch let error as DecodingError {
            return decodeFailure(error)
        } catch {
            return .notAStation(status: nil)
        }
    }

    private static func decodeFailure(_ error: DecodingError) -> StationCheck {
        // JSON, and an object, and missing something the contract requires: a station running an
        // API this app does not match, almost always one not redeployed since the app was built.
        if case .keyNotFound(let key, _) = error { return .incompatible(missing: key.stringValue) }
        // A body that would not parse as the contract at all.
        return .notAStation(status: nil)
    }

    /// The certificate failures `URLSession` reports, found anywhere in the underlying-error chain.
    private static let certificateCodes: Set<Int> = [
        NSURLErrorServerCertificateHasBadDate,
        NSURLErrorServerCertificateUntrusted,
        NSURLErrorServerCertificateHasUnknownRoot,
        NSURLErrorServerCertificateNotYetValid,
        NSURLErrorClientCertificateRejected,
        NSURLErrorClientCertificateRequired,
    ]

    private static func untrustedCertificate(in error: NSError) -> NSError? {
        var current: NSError? = error
        while let candidate = current {
            if candidate.domain == NSURLErrorDomain, certificateCodes.contains(candidate.code) { return candidate }
            current = candidate.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return nil
    }
}
