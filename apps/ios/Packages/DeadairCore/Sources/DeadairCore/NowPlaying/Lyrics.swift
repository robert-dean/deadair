import Foundation
import DeadairSdk

/// Where in the FILE the listener is, which is the timeline every lyric line's `atMs` is on.
///
/// The one place this is worked out. The decoder's `remainingMs` counts down to the record's cue-out,
/// the point the player was told to stop reading, so the position is that point minus what remains.
/// A record nothing has measured plays to the end of the file, whose length is the reading's
/// `durationMs`, which the playhead already carries. Never `startedAt` and the wall clock, for the
/// reason `Playhead.project` gives; and never `durationMs - remainingMs` for a measured record, which
/// runs ahead by however much tail the measurement trimmed. `apps/android`'s `lyricPositionMs`.
public func lyricPositionMs(_ playhead: Playhead, cueOutMs: Int?) -> Int {
    max((cueOutMs ?? playhead.durationMs) - playhead.remainingMs, 0)
}

/// The line being sung at `positionMs`: the last one that has started. `nil` before the first line,
/// and on a blank line, which is the gap a source marks between verses and is not a line to light.
public func currentLine(_ lines: [LyricLineDetail], positionMs: Int) -> Int? {
    var current: Int?
    for (index, line) in lines.enumerated() {
        if line.atMs > positionMs { break }
        current = index
    }
    guard let current, !lines[current].text.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    return current
}

/// The word being sung on `line` at `positionMs`: the index of the last timed piece of it that has
/// started. `nil` on a line its source did not time word by word, which is shown as a line exactly as
/// before, and before the line's first piece. `apps/android`'s `currentWord`.
public func currentWord(_ line: LyricLineDetail, positionMs: Int) -> Int? {
    guard let words = line.words else { return nil }
    var current: Int?
    for (index, word) in words.enumerated() {
        if word.atMs > positionMs { break }
        current = index
    }
    return current
}

/// How many characters of `line`'s text have been sung once piece `word` has started: the pieces up to
/// and including it, joined. The station guarantees the pieces join to the text, so this is a prefix
/// of it; clamped anyway, so a line that broke that promise lights too little rather than trapping.
public func sungLength(_ line: LyricLineDetail, word: Int) -> Int {
    let pieces = (line.words ?? []).prefix(word + 1)
    return min(pieces.reduce(0) { $0 + $1.text.count }, line.text.count)
}

/// What the lyrics sheet, and the button that opens it, have to show.
public enum LyricsUiState: Equatable, Sendable {
    /// Nothing to offer: signed out, off air, a break, an instrumental, a record no source has words
    /// for, or lyrics for another airing. The button is not drawn.
    case hidden
    /// Words with no timings, shown as they came.
    case plain(text: String, provider: String?)
    /// Timed lines. `current` is the line being heard, or `nil` when none is: before the singing, in a
    /// gap, or while the decoder cannot say where the record is. `sung` is how many characters of that
    /// line have been sung, when its source timed the words, and `nil` when it did not or none has
    /// started yet, which lights the line whole as before.
    case synced(lines: [LyricLineDetail], current: Int?, provider: String?, sung: Int? = nil)

    /// The sheet's state from the lyrics answer and what the listener is hearing.
    ///
    /// `heardStartedAt` is the `startedAt` of the reading the screen draws, which on a phone that is
    /// playing is the gate's delayed copy. The lyrics are shown only when they are for that same
    /// airing: both instants are the station's own record of when the record went on, so a
    /// difference means a different record, and across a changeover the station already names the
    /// next one while the listener still hears the last. Showing those words would be the wrong song's.
    public init(answer: NowPlayingLyrics?, heardStartedAt: Int?, playhead: Playhead?) {
        guard let answer, let lyrics = answer.lyrics, let heardStartedAt, answer.startedAt == heardStartedAt else {
            self = .hidden
            return
        }
        switch lyrics.kind {
        // `.unknown` is a kind a newer station sends that this build cannot read, so there are no
        // words to show, as Android's `UNKNOWN` and the desktop's `Unknown` read it.
        case .none, .instrumental, .unknown:
            self = .hidden
        case .words:
            if let lines = lyrics.synced, !lines.isEmpty {
                let position = playhead.map { lyricPositionMs($0, cueOutMs: answer.cueOutMs) }
                let current = position.flatMap { currentLine(lines, positionMs: $0) }
                var sung: Int?
                if let current, let position, let word = currentWord(lines[current], positionMs: position) {
                    sung = sungLength(lines[current], word: word)
                }
                self = .synced(lines: lines, current: current, provider: lyrics.provider, sung: sung)
            } else if let plain = lyrics.plain, !plain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                self = .plain(text: plain, provider: lyrics.provider)
            } else {
                self = .hidden
            }
        }
    }

    /// Which lyrics source the words came from, for the credit under them.
    public var provider: String? {
        switch self {
        case .hidden: nil
        case let .plain(_, provider), let .synced(_, _, provider, _): provider
        }
    }
}
