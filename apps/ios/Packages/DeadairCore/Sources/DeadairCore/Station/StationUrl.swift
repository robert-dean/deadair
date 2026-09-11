import Foundation

/// Where a station is, as the listener typed it and as the app has to use it.
///
/// One origin serves everything: nginx puts the console at the root, proxies the API under `/api`,
/// and proxies the Icecast mounts beside it. So the whole of a station's address is the URL the
/// console loads from, and every other address is derived here rather than configured.
///
/// Held as text, as `StationUrl.kt` holds it, so the derivations are string arithmetic a test can
/// read at a glance. `parse` also refuses anything `URL` cannot hold, which is what lets the `URL`
/// accessors below be non-optional.
public struct StationUrl: Hashable, Sendable, CustomStringConvertible {
    public let origin: String

    private init(origin: String) {
        self.origin = origin
    }

    /// What the SDK is pointed at. The API's routers are mounted at the root behind this prefix.
    public var apiBase: String { "\(origin)/api" }

    public var apiBaseURL: URL { URL(string: apiBase)! }

    /// A mount, from the same-origin path `/nowplaying` reports.
    ///
    /// `mounts[]` carries a leading slash, but an older station took the MP3 path from text an
    /// operator typed (`stream.mount`), so the slash is enforced here rather than assumed.
    public func mountUrl(_ path: String) -> String {
        "\(origin)/\(path.trimmingLeading("/"))"
    }

    /// The same, as a `URL` for the player. `nil` only for a path that cannot be part of one.
    public func mountURL(_ path: String) -> URL? {
        URL(string: mountUrl(path))
    }

    /// Resolve an `artworkUrl` to something an image loader can fetch.
    ///
    /// The station answers one of two things and says which by shape: an absolute URL at the
    /// provider's own CDN, for art nothing has cached yet, or a path relative to the API ROOT
    /// (`art/<uuid>`) once the station holds its own copy. The API mounts its routers at the root
    /// and knows nothing about the `/api` prefix the edge adds, so resolving the relative form is
    /// the client's job, the same job `artSrc` does in the console.
    public func artUrl(_ artworkUrl: String?) -> String? {
        guard let artworkUrl, !artworkUrl.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        if Self.isAbsolute(artworkUrl) { return artworkUrl }
        return "\(apiBase)/\(artworkUrl.trimmingLeading("/"))"
    }

    public var description: String { origin }

    /// Why what was typed is not an address.
    public enum ParseError: Error, Equatable, Sendable {
        /// Nothing, or only a scheme.
        case empty
        /// A scheme other than http or https.
        case notHttp
        /// Something `URL` cannot hold, such as a space in the host.
        case malformed
    }

    /// Read what somebody typed.
    ///
    /// Bare hosts get `https://`, because that is what a station on the public internet is and
    /// guessing the safer scheme costs a listener on a LAN one word. `http://` is accepted without
    /// complaint: the container's own edge is plain HTTP and TLS terminates at whatever the
    /// operator put in front, so a LAN install has no other option, and the UI says so rather
    /// than this refusing it.
    ///
    /// A trailing slash is dropped so nothing downstream builds a `//`. A path is KEPT: an
    /// operator may have mounted the whole station under one, and throwing it away would make that
    /// install unreachable with no way to say why. A query and a fragment are dropped, so pasting
    /// the console's address bar works.
    public static func parse(_ input: String) -> Result<StationUrl, ParseError> {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .failure(.empty) }

        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard isAbsolute(withScheme), let separator = withScheme.range(of: "://") else { return .failure(.notHttp) }

        let scheme = withScheme[..<separator.lowerBound].lowercased()
        // The query and fragment go before the host is split off, so `host?x=1` is a host and
        // not a host named with its query.
        let rest = withScheme[separator.upperBound...].prefix { $0 != "?" && $0 != "#" }
        let host = rest.prefix { $0 != "/" }
        if host.isEmpty { return .failure(.empty) }

        var path = String(rest.dropFirst(host.count))
        while path.hasSuffix("/") { path.removeLast() }

        let origin = "\(scheme)://\(host)\(path)"
        guard let url = URL(string: origin), url.host() != nil else { return .failure(.malformed) }
        return .success(StationUrl(origin: origin))
    }

    private static func isAbsolute(_ text: String) -> Bool {
        let lowered = text.lowercased()
        return lowered.hasPrefix("http://") || lowered.hasPrefix("https://")
    }
}

extension String {
    func trimmingLeading(_ character: Character) -> String {
        String(drop { $0 == character })
    }
}
