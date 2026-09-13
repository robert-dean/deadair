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
    /// The title while the station talks between records: "Cass is on the mic". `host` is the name
    /// the station sent, and absent when it named nobody, which has its own sentence rather than a
    /// blank where the name would go.
    case onTheMic(host: String?)
    /// The line above the record: "Late Static · with Cass". Both halves are the station's words.
    case showWithHost(show: String, host: String)
    /// The same line when the show has no name to give: "with Cass".
    case withHost(String)
    /// The sleep timer's countdown: "Stops in 14 min". Never less than a minute.
    case stopsIn(Span)
    case stopsAfterThisRecord

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

    // MARK: The schedule

    case onAir
    case dueNow
    case upNext
    case afterThat
    case untitled
    /// "1 h 30 min left"
    case left(Span)
    /// "in 1 h 30 min"
    case startsIn(Span)
    case sustainingFor(Span)
    case noBlockDue
    /// "20:00–22:00", or "Mon 09:00–11:00" when the block is not on the station's today.
    case blockHours(BlockHours)

    // MARK: History

    case aired(AiredLabel)
}
