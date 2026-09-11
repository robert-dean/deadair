/// A thing the app says, before it is said in any language.
///
/// The state types that decide what a line says (what the now-playing line reads, what the address
/// field says back, what the account section says after a sign-in) answer with a `Message`, which
/// names WHAT is being said and carries whatever it depends on. The tests assert on that value,
/// and the resolver at the SwiftUI edge turns it into words from the string catalog, where the
/// plurals and the locale live. The resolver's `switch` is exhaustive, so a message without words
/// is a compile error rather than an English fallback. It is `apps/android`'s `Message.kt`, member
/// for member where the two apps say the same thing.
///
/// `text` is the one case that carries words rather than naming them, and it is for words the
/// STATION sent: a title, a credit. App copy never goes through it; the moment it does, that string
/// cannot be translated and nothing will say so.
public enum Message: Equatable, Sendable {
    /// Words the station sent, shown as they came. Never app copy.
    case text(String)

    // MARK: Now playing

    case warmingUp
    case offAir
    case cantReachStation
    case quietUntilSomeoneTunesIn
    case comingOnAir
    case showingLastSaid
    /// "N listening · MP3", with the count spelled the way the language counts.
    case listeners(count: Int, format: StreamFormat)
    case fellBackToMp3(wanted: StreamFormat)

    // MARK: The address field

    case answeredAs(name: String)
    case notEncrypted
    case notAnAddress
    case unknownShape
    case olderApi(missing: String)
    case notAStation
    case answeredStatus(Int)
    case couldNotReach
    case untrusted

    // MARK: The account

    case badCredentials
    case couldNotReachToSignIn
    case secondFactorUnsupported
    case codeRefused
    case signInExpired
    case factorRefused
    case noRefreshToken
}
