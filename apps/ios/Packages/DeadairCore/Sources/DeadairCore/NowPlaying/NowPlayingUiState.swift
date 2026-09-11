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

    public init(air: AirState, listeners: Int, format: StreamFormat, playing: Bool, buffering: Bool, fellBackToMp3: Bool = false, stale: Bool = false) {
        self.air = air
        self.listeners = listeners
        self.format = format
        self.playing = playing
        self.buffering = buffering
        self.fellBackToMp3 = fellBackToMp3
        self.stale = stale
    }

    public var title: Message {
        switch air {
        case .onAir(let track): .text(track.title)
        case .warmingUp: .warmingUp
        case .offAir: .offAir
        case .unreachable: .cantReachStation
        }
    }

    public var subtitle: Message? {
        switch air {
        case .onAir(let track): track.artist.trimmingCharacters(in: .whitespaces).isEmpty ? nil : .text(track.artist)
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
        if case .onAir(let track) = air { return track.album }
        return nil
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
