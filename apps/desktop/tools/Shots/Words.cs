using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace Shots;

/// <summary>
/// The posed record's words, written for these frames. Never a real song's: a lyric is somebody's
/// work, and a picture of the layout needs only lines of the right lengths, one long enough to wrap
/// and one blank gap between verses.
/// </summary>
internal static class Words
{
    private static readonly string[] Text =
    [
        "The kettle sings before the morning does",
        "And every window holds a different town",
        "I left the radio on for company",
        "",
        "Somebody somewhere plays the record through, the long way round, the version with the second chorus nobody remembers",
        "Static on the dial like rain on tin",
        "We were always going to be late",
        "So we might as well be loud",
        "",
        "Turn it up, the neighbours never minded",
        "Turn it up, the night is still a rumour",
        "Turn it up and let the wires hum",
    ];

    private static readonly IReadOnlyList<LyricLineDetail> Lines =
        [.. Text.Select((text, index) => new LyricLineDetail { AtMs = 12_000 + (index * 4_000), Text = text })];

    /// <summary>Timed lines, the sixth lit, so two lines sit above it once the column has scrolled.</summary>
    public static void Synced(ListenerViewModel listener) =>
        listener.Lyrics.Show(new LyricsUiState.Synced(Lines, 5, "deadair.lrclib"));

    /// <summary>Words with no timings, shown whole.</summary>
    public static void Plain(ListenerViewModel listener) =>
        listener.Lyrics.Show(new LyricsUiState.Plain(string.Join('\n', Text.Take(8)), "deadair.lrclib"));

    /// <summary>Studio with the words in the cover's place.</summary>
    public static void InStudio(ListenerViewModel listener)
    {
        Synced(listener);
        listener.Lyrics.WordsInStudio = true;
    }

    /// <summary>Studio with words that have no timings in the cover's place.</summary>
    public static void PlainInStudio(ListenerViewModel listener)
    {
        Plain(listener);
        listener.Lyrics.WordsInStudio = true;
    }
}
