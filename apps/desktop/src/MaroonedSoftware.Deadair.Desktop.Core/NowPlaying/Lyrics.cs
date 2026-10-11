using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>
/// Where the listener is in the record they hear, as the lyric rules need it: how far in, and how long.
/// </summary>
/// <remarks>
/// <see cref="Playhead.Position"/> answers ELAPSED and the decoder's figure is REMAINING, so this carries
/// both halves of the one reading and lets <see cref="Lyrics.PositionMs"/> say which it counts from.
/// </remarks>
/// <param name="ElapsedMs">How far into the record the listener is.</param>
/// <param name="DurationMs">The record's length, the file's.</param>
public readonly record struct HeardPlayhead(long ElapsedMs, long DurationMs)
{
    /// <summary>How much of the file is left at <see cref="ElapsedMs"/>, as the decoder counts it.</summary>
    public long RemainingMs => DurationMs - ElapsedMs;

    /// <summary>
    /// The playhead projected from a held reading, or null when <see cref="Playhead.Position"/> cannot
    /// say. Never the wall clock since <c>startedAt</c>; that is the playhead's own rule.
    /// </summary>
    public static HeardPlayhead? From(NowPlayingTrack? track, DateTimeOffset? readAt, DateTimeOffset now)
    {
        if (Playhead.Position(track, readAt, now) is not { } elapsed || Playhead.Duration(track) is not { } duration)
        {
            return null;
        }

        return new HeardPlayhead((long)elapsed.TotalMilliseconds, (long)duration.TotalMilliseconds);
    }
}

/// <summary>
/// The lyric rules the Android and iOS listeners follow, in the same words: where in the file the
/// listener is, which line is being sung, and what there is to show.
/// </summary>
public static class Lyrics
{
    /// <summary>
    /// Where in the FILE the listener is, which is the timeline every lyric line's <c>atMs</c> is on.
    /// </summary>
    /// <remarks>
    /// The one place this is worked out. The decoder's <c>remainingMs</c> counts down to the record's
    /// cue-out, the point the player was told to stop reading, so the position is that point minus what
    /// remains. A record nothing has measured plays to the end of the file, whose length is the
    /// reading's <c>durationMs</c>. Never <c>startedAt</c> and the wall clock, for the reason
    /// <see cref="Playhead"/> gives; and never <c>durationMs - remainingMs</c> for a measured record,
    /// which runs ahead by however much tail the measurement trimmed.
    /// </remarks>
    public static long PositionMs(HeardPlayhead playhead, long? cueOutMs) =>
        Math.Max((cueOutMs ?? playhead.DurationMs) - playhead.RemainingMs, 0);

    /// <summary>
    /// The line being sung at <paramref name="positionMs"/>: the last one that has started. Null before
    /// the first line, and on a blank line, which is the gap a source marks between verses and is not a
    /// line to light.
    /// </summary>
    public static int? CurrentLine(IReadOnlyList<LyricLineDetail> lines, long positionMs)
    {
        int? current = null;
        for (var index = 0; index < lines.Count; index++)
        {
            if (lines[index].AtMs > positionMs)
            {
                break;
            }

            current = index;
        }

        return current is { } found && !string.IsNullOrWhiteSpace(lines[found].Text) ? found : null;
    }

    /// <summary>
    /// The word being sung on <paramref name="line"/> at <paramref name="positionMs"/>: the index of the
    /// last timed piece of it that has started. Null on a line its source did not time word by word,
    /// which is shown as a line exactly as before, and before the line's first piece.
    /// </summary>
    public static int? CurrentWord(LyricLineDetail line, long positionMs)
    {
        if (line.Words is not { } words)
        {
            return null;
        }

        int? current = null;
        for (var index = 0; index < words.Count; index++)
        {
            if (words[index].AtMs > positionMs)
            {
                break;
            }

            current = index;
        }

        return current;
    }

    /// <summary>
    /// How many characters of <paramref name="line"/>'s text have been sung once piece
    /// <paramref name="word"/> has started: the pieces up to and including it, joined.
    /// </summary>
    /// <remarks>
    /// The station guarantees the pieces join to the text, so this is a prefix of it; clamped anyway, so
    /// a line that broke that promise lights too little rather than throwing.
    /// </remarks>
    public static int SungLength(LyricLineDetail line, int word)
    {
        var sung = 0;
        var words = line.Words ?? [];
        for (var index = 0; index <= word && index < words.Count; index++)
        {
            sung += words[index].Text.Length;
        }

        return Math.Min(sung, line.Text.Length);
    }

    /// <summary>Whether any of <paramref name="lines"/> was timed word by word.</summary>
    public static bool HasWordTimings(IReadOnlyList<LyricLineDetail> lines)
    {
        foreach (var line in lines)
        {
            if (line.Words is { Count: > 0 })
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// What the lyrics section, and the button that opens them, have to show.
    /// </summary>
    /// <remarks>
    /// <paramref name="heardStartedAt"/> is the <c>startedAt</c> of the reading the screen draws, the
    /// held one. The lyrics are shown only when they are for that same airing: both instants are the
    /// station's own record of when the record went on, so a difference means a different record, and
    /// across a changeover the station already names the next one while the listener still hears the
    /// last. Showing those words, lit or not, would be the wrong song's.
    /// </remarks>
    public static LyricsUiState State(NowPlayingLyrics? answer, long? heardStartedAt, HeardPlayhead? playhead)
    {
        if (answer?.Lyrics is not { } lyrics || heardStartedAt is not { } heard || answer.StartedAt != heard)
        {
            return LyricsUiState.Hidden.Instance;
        }

        if (lyrics.Kind != TrackLyricsKind.Words)
        {
            return LyricsUiState.Hidden.Instance;
        }

        if (lyrics.Synced is { Count: > 0 } lines)
        {
            long? position = playhead is { } at ? PositionMs(at, answer.CueOutMs) : null;
            var current = position is { } fileMs ? CurrentLine(lines, fileMs) : null;
            int? sung = current is { } line && position is { } now && CurrentWord(lines[line], now) is { } word
                ? SungLength(lines[line], word)
                : null;
            return new LyricsUiState.Synced(lines, current, lyrics.Provider, sung);
        }

        if (!string.IsNullOrWhiteSpace(lyrics.Plain))
        {
            return new LyricsUiState.Plain(lyrics.Plain, lyrics.Provider);
        }

        return LyricsUiState.Hidden.Instance;
    }
}

/// <summary>What the lyrics section, and the button that opens it, have to show.</summary>
public abstract record LyricsUiState
{
    private LyricsUiState()
    {
    }

    /// <summary>
    /// Nothing to offer: signed out, off air, a break, an instrumental, a record no source has words
    /// for, or lyrics for another airing. The button is not drawn.
    /// </summary>
    public sealed record Hidden : LyricsUiState
    {
        /// <summary>The one value.</summary>
        public static Hidden Instance { get; } = new();

        private Hidden()
        {
        }
    }

    /// <summary>Words with no timings, shown as they came.</summary>
    public sealed record Plain(string Text, string? Provider) : LyricsUiState;

    /// <summary>
    /// Timed lines. <paramref name="Current"/> is the line being heard, or null when none is: before the
    /// singing, in a gap, or while the decoder cannot say where the record is. <paramref name="Sung"/> is
    /// how many characters of that line have been sung, when its source timed the words, and null when
    /// it did not or none has started yet, which lights the line whole as before.
    /// </summary>
    public sealed record Synced(IReadOnlyList<LyricLineDetail> Lines, int? Current, string? Provider, int? Sung = null) : LyricsUiState;
}
