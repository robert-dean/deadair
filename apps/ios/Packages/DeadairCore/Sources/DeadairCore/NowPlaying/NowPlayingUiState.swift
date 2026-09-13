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

    /// The line above the record: the show and who presents it, as far as the station said. Only on
    /// air, because a quiet station has no programme, and a stale show over "can't reach the
    /// station" would name something nobody can hear.
    public var header: Message? {
        guard case .onAir = air else { return nil }
        switch (nonBlank(show?.name), nonBlank(show?.host)) {
        case let (name?, host?): return .showWithHost(show: name, host: host)
        case let (name?, nil): return .text(name)
        case let (nil, host?): return .withHost(host)
        case (nil, nil): return nil
        }
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

    /// The line under the controls: who is listening, and how. The count is spelled by the language.
    public var footer: Message { .listeners(count: listeners, format: format) }

    /// Said only when the chosen format was not there to be had.
    public var fallbackNote: Message? { fellBackToMp3 ? .fellBackToMp3(wanted: format) : nil }
}

/// The station's words, or nothing when they are blank: a blank name is no name to show.
func nonBlank(_ words: String?) -> String? {
    guard let words, !words.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    return words
}
