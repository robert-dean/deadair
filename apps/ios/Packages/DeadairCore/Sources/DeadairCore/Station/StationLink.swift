import Foundation

/// A `deadair://` link, which names a station for the app to be pointed at.
///
/// The desktop app's grammar exactly (`Core/Station/StationLink.cs`), and Android's, so one link the
/// console writes opens whichever app is installed. Two forms. `deadair://connect?station=<origin>`
/// carries the whole origin, escaped, and is what the console writes: it is the only form that can
/// name a plain-http station on a home network, which is where most of these run.
/// `deadair://radio.example.com` is shorthand for an https station, for somebody typing one by hand.
/// Anything else is refused rather than guessed at, and so is anything carrying a user or a password:
/// a link names a place, never a way in.
///
/// A link only ever PROPOSES a station. Setup shows the address filled in, and nothing is kept until it
/// has answered and somebody has pressed Listen, so a link in an email cannot quietly repoint the app.
public enum StationLink {
    public static let scheme = "deadair"
    private static let connectHost = "connect"

    /// The station a link names, or `nil` for anything this app does not write.
    public static func parse(_ text: String?) -> StationUrl? {
        guard let text, !text.trimmingCharacters(in: .whitespaces).isEmpty,
              let link = URLComponents(string: text),
              link.scheme?.lowercased() == scheme,
              link.percentEncodedUser == nil, link.percentEncodedPassword == nil
        else { return nil }

        if link.percentEncodedHost?.lowercased() == connectHost {
            guard let origin = query(link, "station"), !origin.isEmpty, origin.contains("://"), !carriesUser(origin) else { return nil }
            return try? StationUrl.parse(origin).get()
        }

        // The shorthand: a host and nothing else. A path or a query on it is not something this app
        // writes, so it is not something to interpret.
        guard let host = link.percentEncodedHost, !host.isEmpty,
              link.percentEncodedQuery == nil, link.percentEncodedFragment == nil,
              link.percentEncodedPath.isEmpty || link.percentEncodedPath == "/"
        else { return nil }
        let authority = link.port.map { "\(host):\($0)" } ?? host
        return try? StationUrl.parse("https://\(authority)").get()
    }

    /// What a link proposes, given the station already kept: `nil` when it names that same station,
    /// which closes the question rather than asking it again.
    public static func proposal(_ link: StationUrl, kept: StationUrl?) -> StationUrl? {
        link.origin == kept?.origin ? nil : link
    }

    /// Whether an escaped origin smuggles in what the link's own authority is refused for.
    private static func carriesUser(_ origin: String) -> Bool {
        guard let parts = URLComponents(string: origin) else { return true }
        return parts.percentEncodedUser != nil || parts.percentEncodedPassword != nil
    }

    /// `+` is a space, as a form encodes one, which is how the desktop and Android read it too.
    private static func query(_ link: URLComponents, _ name: String) -> String? {
        for pair in (link.percentEncodedQuery ?? "").split(separator: "&") where !pair.isEmpty {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard decode(parts[0]) == name else { continue }
            return parts.count > 1 ? decode(parts[1]) : ""
        }
        return nil
    }

    private static func decode(_ text: Substring) -> String? {
        text.replacingOccurrences(of: "+", with: " ").removingPercentEncoding
    }
}
