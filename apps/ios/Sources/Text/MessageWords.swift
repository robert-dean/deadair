import DeadairCore
import Foundation

/// Where a `Message` becomes words, and the only place app copy is written.
///
/// Every string goes through `String(localized:)`, so the catalog can translate it and give the
/// counted ones their plural forms. The `switch` is exhaustive on purpose: a message added to
/// `DeadairCore` without words here is a compile error rather than an English fallback, which is
/// the rule `apps/android` keeps with `strings.xml`.
extension Message {
    var words: String {
        switch self {
        case .text(let words): words

        case .warmingUp: String(localized: "Coming on air")
        case .offAir: String(localized: "Off air")
        case .cantReachStation: String(localized: "Can't reach the station")
        case .quietUntilSomeoneTunesIn: String(localized: "The station is quiet until somebody tunes in. Press play to put it on air.")
        case .comingOnAir: String(localized: "The station is taking the air. The first seconds are quiet.")
        case .showingLastSaid: String(localized: "Showing what it said last.")
        case .listeners(let count, let format): String(localized: "\(count) listening · \(format.label)")
        case .fellBackToMp3(let wanted): String(localized: "This station does not publish \(wanted.label), so you are hearing MP3.")
        case .onTheMic(let host?): String(localized: "\(host) is on the mic")
        case .onTheMic(nil): String(localized: "The host is on the mic")
        case .showWithHost(let show, let host): String(localized: "\(show) · with \(host)")
        case .withHost(let host): String(localized: "with \(host)")
        case .stopsIn(let span): String(localized: "Stops in \(span.words)")
        case .stopsAfterThisRecord: String(localized: "Stops after this record")

        case .answeredAs(let name): String(localized: "Found \(name).")
        case .notEncrypted: String(localized: "Not encrypted. Fine on your own network.")
        case .notAnAddress: String(localized: "That is not a web address.")
        case .unknownShape: String(localized: "A deadair station answered, in a shape this app does not know. It may need updating.")
        case .olderApi(let missing): String(localized: "A deadair station answered without \(missing). It may be running an older version.")
        case .notAStation: String(localized: "Something answered, and it is not a deadair station.")
        case .answeredStatus(let status): String(localized: "Something answered with HTTP \(status), and it is not a deadair station.")
        case .couldNotReach: String(localized: "Nothing answered. Check the address and your connection.")
        case .untrusted: String(localized: "It answered with a certificate this iPhone does not trust. Install and trust the station's certificate authority, or use its public address.")

        case .badCredentials: String(localized: "That email and password were not accepted.")
        case .couldNotReachToSignIn: String(localized: "Could not reach the station to sign in.")
        case .secondFactorUnsupported: String(localized: "This account's second factor is not an authenticator app. Sign in from the console.")
        case .codeRefused: String(localized: "That code was not accepted.")
        case .signInExpired: String(localized: "That sign-in expired. Enter your password again.")
        case .factorRefused: String(localized: "The station refused that authenticator. Start again.")
        case .noRefreshToken: String(localized: "The station issued a session that cannot be renewed, so it was not kept.")

        case .onAir: String(localized: "On air")
        case .dueNow: String(localized: "Due now")
        case .upNext: String(localized: "Up next")
        case .afterThat: String(localized: "After that")
        case .untitled: String(localized: "Untitled")
        case .left(let span): String(localized: "\(span.words) left")
        case .startsIn(let span): String(localized: "in \(span.words)")
        case .sustainingFor(let span): String(localized: "The station is on its sustaining source for the next \(span.words).")
        case .noBlockDue: String(localized: "No block is due from here on, so the station stays on whatever it is set to sustain on.")
        case .blockHours(let hours):
            if let day = hours.day {
                String(localized: "\(day.shortName) \(hours.from.words)–\(hours.to.words)")
            } else {
                String(localized: "\(hours.from.words)–\(hours.to.words)")
            }

        case .aired(let label): label.words
        }
    }
}

extension Span {
    /// A length as it is said: "45 min", "1 h 30 min", "a day", "6 days".
    var words: String {
        switch self {
        case .ending: String(localized: "ending")
        case .minutes(let minutes): String(localized: "\(minutes) min")
        case .hours(let hours, minutes: 0): String(localized: "\(hours) h")
        case .hours(let hours, let minutes): String(localized: "\(hours) h \(minutes) min")
        case .aDay: String(localized: "a day")
        case .days(let days): String(localized: "\(days) days")
        }
    }
}

extension Clock {
    /// The time in the form this phone is set to, twelve-hour or twenty-four.
    var words: String {
        var parts = DateComponents()
        parts.hour = hour
        parts.minute = minute
        guard let date = Calendar.current.date(from: parts) else { return "\(hour):\(minute)" }
        return date.formatted(date: .omitted, time: .shortened)
    }
}

extension Weekday {
    /// "Mon", in the phone's language.
    var shortName: String { Calendar.current.shortWeekdaySymbols[rawValue - 1] }
}

extension AiredLabel {
    var words: String {
        switch self {
        case .today(let clock): clock.words
        case .yesterday(let clock): String(localized: "Yesterday \(clock.words)")
        case .weekday(let day, let clock): String(localized: "\(day.shortName) \(clock.words)")
        case .onDate(let year, let month, let day):
            Calendar.current.date(from: DateComponents(year: year, month: month, day: day))?.formatted(date: .abbreviated, time: .omitted) ?? ""
        }
    }
}

extension ListeningState {
    /// What the play button's neighbour says about the player.
    var words: String? {
        switch self {
        case .stopped, .playing: nil
        case .warmingUp: String(localized: "Coming on air")
        case .reconnecting: String(localized: "Reconnecting")
        case .unreachable: String(localized: "Can't reach the stream")
        }
    }
}
