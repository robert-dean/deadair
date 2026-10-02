import Foundation
import DeadairSdk

/// The Now playing screen, as data.
///
/// Separated from the SwiftUI code so the one thing worth testing here, what the status line SAYS,
/// is a function a test can call. The words matter: "off air" has to read as an ordinary state and
/// not as a fault, because on an audience-gated station it is what quiet looks like.
public struct NowPlayingUiState: Equatable, Sendable {
    public var air: AirState
    public var listeners: Int
    public var format: StreamFormat
    public var playing: Bool
    public var buffering: Bool
    /// True when the chosen format was not published and MP3 was taken instead.
    public var fellBackToMp3: Bool
    /// Whether what is on screen came from a reading that has since gone stale.
    public var stale: Bool
    /// The programme on air, as the station last described it. A station-level fact rather than the
    /// record's, which is why it rides here and not on `AirState.onAir`.
    public var show: NowPlayingShow?

    public init(
        air: AirState, listeners: Int, format: StreamFormat, playing: Bool, buffering: Bool, fellBackToMp3: Bool = false, stale: Bool = false,
        show: NowPlayingShow? = nil
    ) {
        self.air = air
        self.listeners = listeners
        self.format = format
        self.playing = playing
        self.buffering = buffering
        self.fellBackToMp3 = fellBackToMp3
        self.stale = stale
        self.show = show
    }

    /// What is on air when it is the station talking between records rather than a record.
    private var spokenBreak: NowPlayingTrack? {
        if case .onAir(let track) = air, track.kind == .break { return track }
        return nil
    }

    /// During a break, who is talking rather than the break's label: a listener glancing at the
    /// screen wants to know the music stopped because the host is on, and the label ("Top of the
    /// hour") is the station's own filing name for it.
    public var title: Message {
        switch air {
        case .onAir(let track): spokenBreak == nil ? .text(track.title) : .onTheMic(host: nonBlank(show?.host))
        case .warmingUp: .warmingUp
        case .offAir: .offAir
        case .unreachable: .cantReachStation
        }
    }

    public var subtitle: Message? {
        switch air {
        // A break has no artist, so its label goes where the artist would.
        case .onAir(let track): nonBlank(spokenBreak == nil ? track.artist : track.title).map(Message.text)
        // An invitation rather than a status. On an audience-gated station this is the normal
        // resting state, and the surprising fact about it is that pressing play is what puts the
        // station on air: a line that read "nobody is listening" over a play button made the
        // button look pointless, when it was the whole answer.
        case .offAir: .quietUntilSomeoneTunesIn
        case .warmingUp: .comingOnAir
        case .unreachable: stale ? .showingLastSaid : nil
        }
    }

    public var album: String? {
        if case .onAir(let track) = air, spokenBreak == nil { return track.album }
        return nil
    }

    /// Who is presenting, under the credit. Only on air, because a stale presenter over "can't reach
    /// the station" would name somebody nobody can hear, and not during a break, whose title already
    /// says who is on the mic.
    ///
    /// The show's NAME is never drawn. It is the operator's own label, and for a broadcast without
    /// one the station makes one up from where the records came from ("From Spotify"), which on a
    /// listener's screen read as software rather than as a programme. `apps/android`'s `hostLine`.
    public var hostLine: Message? {
        guard case .onAir = air, spokenBreak == nil else { return nil }
        return nonBlank(show?.host).map(Message.withHost)
    }

    /// Whether the subtitle is a credit that may scroll past, or a sentence that has to wrap.
    ///
    /// A long artist line scrolls the way it does on every player a listener has used. App copy
    /// does not: the off-air line is a whole sentence, and a marquee that scrolled it showed a
    /// listener the middle of an instruction with its first word gone.
    public var subtitleScrolls: Bool {
        if case .text = subtitle { return true }
        return false
    }

    /// Whether the screen may give itself to the cover when left alone: only while a record is
    /// actually coming out of the phone. Warming up, off air, unreachable or stale, the words are
    /// the news, and hiding them would hide the one thing worth reading.
    public var canRest: Bool {
        guard case .onAir = air else { return false }
        return playing && !buffering && !stale
    }

    /// Said only when the chosen format was not there to be had.
    public var fallbackNote: Message? { fellBackToMp3 ? .fellBackToMp3(wanted: format) : nil }
}

/// The station's words, or nothing when they are blank: a blank name is no name to show.
public func nonBlank(_ words: String?) -> String? {
    guard let words, !words.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    return words
}
