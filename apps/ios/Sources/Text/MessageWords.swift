import DeadairCore
import DeadairSdk
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

        case .foldedHistory(let played, let passed):
            [
                played > 0 ? String(localized: "\(played) played earlier") : nil,
                passed > 0 ? String(localized: "\(passed) skipped") : nil,
            ]
            .compactMap { $0 }
            .joined(separator: ", ")
            .nonEmpty ?? String(localized: "Earlier in this broadcast")
        case .itemState(let state): state.words
        case .notWrittenYet: String(localized: "Not written yet")
        case .noAudioYet: String(localized: "No audio yet")
        case .willSkip: String(localized: "Will skip")
        case .stationsHost: String(localized: "The station's host")
        case .noHost: String(localized: "Nobody")

        case .recordNotFound: String(localized: "No record with that id is in the catalog.")
        case .albumNotFound: String(localized: "No album with that id is in the catalog.")
        case .artistNotFound: String(localized: "No artist with that id is in the catalog.")
        case .airedTimes(0): String(localized: "Never aired")
        case .airedTimes(let count): String(localized: "Aired \(count) times")
        case .trackCount(let count): String(localized: "\(count) tracks")
        case .albumCount(let count): String(localized: "\(count) albums")
        case .moreNotShown(let count): String(localized: "\(count) more not shown")
        case .field(let field): field.words
        case .provenance(let source): source.words

        case .outcome(.written): String(localized: "Written")
        case .outcome(.declined): String(localized: "Declined")
        case .outcome(.failed): String(localized: "Failed")
        case .writer("model"): String(localized: "Model")
        case .writer("deterministic"): String(localized: "Floor")
        case .writer(let other): other
        case .scriptFact(let label): label.words
        case .shareBreak: String(localized: "Share this break")
        case .shareGone: String(localized: "The station no longer has the audio for that break.")
        case .shareCannotCopy: String(localized: "The station can't make a copy to send right now.")
        case .shareCouldNotReach: String(localized: "Couldn't reach the station to get that break.")
        case .shareFailed: String(localized: "Couldn't get that break ready to send.")

        case .operatorNotice(let notice): notice.words
        }
    }
}

extension ScriptFactLabel {
    var words: String {
        switch self {
        case .kind: String(localized: "Kind")
        case .host: String(localized: "Host")
        case .model: String(localized: "Model")
        case .from: String(localized: "From")
        case .took: String(localized: "Took")
        case .tokens: String(localized: "Tokens")
        case .after: String(localized: "After")
        case .before: String(localized: "Before")
        case .note: String(localized: "Note")
        }
    }
}

extension EnrichmentField {
    var words: String {
        switch self {
        case .released: String(localized: "Providers say released")
        case .label: String(localized: "Label")
        case .bpm: String(localized: "BPM")
        case .key: String(localized: "Key")
        case .isrc: String(localized: "ISRC")
        }
    }
}

extension Provenance {
    /// "musicbrainz · 3 May 2026", and "· due again" when the station will ask it again.
    var words: String {
        let date = fetchedAt.formatted(date: .abbreviated, time: .omitted)
        let state = switch self.state {
        case .found: date
        case .nothingFound: String(localized: "nothing found")
        case .couldNotAsk: String(localized: "could not ask")
        case .couldNotReask: String(localized: "\(date), could not re-ask")
        }
        let line = String(localized: "\(provider) · \(state)")
        return stale ? String(localized: "\(line) · due again") : line
    }
}

extension StationItemState {
    var words: String {
        switch self {
        case .planned: String(localized: "Planned")
        case .handed: String(localized: "Handed over")
        case .airing: String(localized: "On air")
        case .played: String(localized: "Played")
        case .skipped: String(localized: "Skipped")
        case .unavailable: String(localized: "Unavailable")
        case .removed: String(localized: "Removed")
        }
    }
}

extension String {
    /// Itself, or `nil` when there is nothing in it.
    var nonEmpty: String? { isEmpty ? nil : self }
}

extension Notice {
    var words: String {
        switch self {
        case .noLongerOperator: String(localized: "The station no longer treats this account as its operator.")
        case .stepUpNeeded: String(localized: "The station wants your authenticator code again before that. Do it on the console.")
        case .nothingToResume: String(localized: "Nothing to resume: the station has not been put on air yet.")
        case .playlistEmpty: String(localized: "That playlist has nothing the station can play.")
        case .hostGone: String(localized: "That persona is no longer on the station.")
        case .recordGone: String(localized: "The station no longer has that record.")
        case .recordRefused: String(localized: "The station will not play that record now.")
        case .couldNotReach: String(localized: "Could not reach the station to do that.")
        case .failed(let status): String(localized: "The station refused that (\(status)).")
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
