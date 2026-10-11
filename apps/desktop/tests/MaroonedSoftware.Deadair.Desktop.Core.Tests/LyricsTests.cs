using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class LyricsTests
{
    private static readonly Guid Track = Guid.Parse("33333333-3333-4333-8333-333333333333");
    private const long Started = 1_790_000_000_000;

    private static readonly List<LyricLineDetail> Lines =
    [
        new() { AtMs = 10_000, Text = "First line" },
        new() { AtMs = 14_000, Text = "Second line" },
        new() { AtMs = 18_000, Text = "" },
        new() { AtMs = 25_000, Text = "After the gap" },
    ];

    private static NowPlayingLyrics Answer(
        TrackLyricsKind kind = TrackLyricsKind.Words,
        List<LyricLineDetail>? synced = null,
        bool noSynced = false,
        string? plain = null,
        long? cueOutMs = null,
        long startedAt = Started) => new()
    {
        OnAir = true,
        TrackId = Track,
        StartedAt = startedAt,
        CueOutMs = cueOutMs,
        Lyrics = new TrackLyrics
        {
            TrackId = Track,
            Kind = kind,
            Provider = "deadair.lrclib",
            Synced = noSynced ? null : synced ?? Lines,
            Plain = plain,
        },
    };

    /// <summary>A playhead <paramref name="elapsed"/> into a record of <paramref name="duration"/>.</summary>
    private static HeardPlayhead At(long elapsed, long duration = 240_000) => new(elapsed, duration);

    [Fact]
    public void AnUnmeasuredRecordsPosition_IsItsLengthMinusWhatRemains() =>
        Assert.Equal(15_000, Lyrics.PositionMs(At(15_000), cueOutMs: null));

    [Fact]
    public void AMeasuredRecordsPosition_CountsBackFromTheCueOutNotFromTheFilesLength()
    {
        // Three seconds of tail trimmed: 200s left of a 240s file is 37s in, not 40s.
        var playhead = new HeardPlayhead(ElapsedMs: 40_000, DurationMs: 240_000);
        Assert.Equal(200_000, playhead.RemainingMs);
        Assert.Equal(37_000, Lyrics.PositionMs(playhead, cueOutMs: 237_000));
    }

    [Fact]
    public void TheCurrentLine_IsTheLastOneThatHasStarted()
    {
        Assert.Null(Lyrics.CurrentLine(Lines, 9_999));
        Assert.Equal(0, Lyrics.CurrentLine(Lines, 10_000));
        Assert.Equal(1, Lyrics.CurrentLine(Lines, 17_999));
        Assert.Equal(3, Lyrics.CurrentLine(Lines, 300_000));
    }

    [Fact]
    public void ABlankLineIsAGap_AndLightsNothing() => Assert.Null(Lyrics.CurrentLine(Lines, 20_000));

    [Fact]
    public void TimedLinesAreLit_FromTheHeardPlayhead()
    {
        var state = Assert.IsType<LyricsUiState.Synced>(Lyrics.State(Answer(), Started, At(15_000)));
        Assert.Equal(1, state.Current);
        Assert.Equal("deadair.lrclib", state.Provider);
    }

    [Fact]
    public void ADecoderThatCannotSayWhereItIs_ShowsTheLinesUnlit()
    {
        var state = Assert.IsType<LyricsUiState.Synced>(Lyrics.State(Answer(), Started, playhead: null));
        Assert.Null(state.Current);
    }

    [Fact]
    public void LyricsForAnotherAiring_AreNotShownAtAll()
    {
        // The station names the next record while this listener still hears the last one.
        Assert.Equal(LyricsUiState.Hidden.Instance, Lyrics.State(Answer(startedAt: Started + 240_000), Started, At(230_000)));
        Assert.Equal(LyricsUiState.Hidden.Instance, Lyrics.State(Answer(), heardStartedAt: null, playhead: null));
    }

    [Fact]
    public void PlainWordsShow_WhenThereAreNoTimings() =>
        Assert.Equal(
            new LyricsUiState.Plain("Words only", "deadair.lrclib"),
            Lyrics.State(Answer(noSynced: true, plain: "Words only"), Started, At(1_000)));

    [Fact]
    public void NothingToShow_DrawsNoButton()
    {
        Assert.Equal(LyricsUiState.Hidden.Instance, Lyrics.State(null, Started, At(1_000)));
        Assert.Equal(LyricsUiState.Hidden.Instance, Lyrics.State(Answer(kind: TrackLyricsKind.None, noSynced: true), Started, At(1_000)));
        Assert.Equal(LyricsUiState.Hidden.Instance, Lyrics.State(Answer(kind: TrackLyricsKind.Instrumental, noSynced: true), Started, At(1_000)));
        Assert.Equal(LyricsUiState.Hidden.Instance, Lyrics.State(Answer(synced: [], plain: " "), Started, At(1_000)));
    }

    [Fact]
    public void TheHeardPlayhead_IsProjectedFromTheHeldReadingAndRefusesWithoutRemaining()
    {
        var readAt = new DateTimeOffset(2026, 10, 11, 12, 0, 0, TimeSpan.Zero);
        var track = new NowPlayingTrack { Title = "Jeremy", Artist = "Pearl Jam", StartedAt = Started, DurationMs = 240_000, RemainingMs = 200_000 };

        Assert.Equal(new HeardPlayhead(45_000, 240_000), HeardPlayhead.From(track, readAt, readAt.AddSeconds(5)));
        Assert.Null(HeardPlayhead.From(track with { RemainingMs = null }, readAt, readAt.AddSeconds(5)));
    }

    private static readonly LyricLineDetail Worded = new()
    {
        AtMs = 10_000,
        Text = "So beautiful",
        Words =
        [
            new() { AtMs = 10_000, Text = "So " },
            new() { AtMs = 10_400, Text = "beau" },
            new() { AtMs = 10_700, Text = "tiful" },
        ],
    };

    [Fact]
    public void TheCurrentWord_IsTheLastPieceThatHasStarted()
    {
        Assert.Null(Lyrics.CurrentWord(Worded, 9_999));
        Assert.Equal(0, Lyrics.CurrentWord(Worded, 10_000));
        Assert.Equal(1, Lyrics.CurrentWord(Worded, 10_699));
        Assert.Equal(2, Lyrics.CurrentWord(Worded, 60_000));
    }

    [Fact]
    public void ALineTimedOnlyAsALine_HasNoCurrentWord() => Assert.Null(Lyrics.CurrentWord(Lines[0], 12_000));

    [Fact]
    public void TheSungPart_IsThePiecesSoFarJoined()
    {
        Assert.Equal(3, Lyrics.SungLength(Worded, 0));
        Assert.Equal(7, Lyrics.SungLength(Worded, 1));
        Assert.Equal(Worded.Text.Length, Lyrics.SungLength(Worded, 2));
    }

    [Fact]
    public void TheSungPart_OfALineThatDoesNotJoinUp_IsClampedToTheLine()
    {
        var broken = Worded with { Text = "So" };
        Assert.Equal(2, Lyrics.SungLength(broken, 2));
    }

    [Fact]
    public void TheState_LightsTheSungPartOfAWordedLine_AndNoneOfAPlainOne()
    {
        var state = Assert.IsType<LyricsUiState.Synced>(Lyrics.State(Answer(synced: [Worded, Lines[1]]), Started, At(10_500)));
        Assert.Equal(0, state.Current);
        Assert.Equal(7, state.Sung);

        var plainLine = Assert.IsType<LyricsUiState.Synced>(Lyrics.State(Answer(), Started, At(15_000)));
        Assert.Null(plainLine.Sung);
    }

    [Fact]
    public void WordTimings_AreFoundOnlyWhereASourceGaveThem()
    {
        Assert.True(Lyrics.HasWordTimings([Lines[0], Worded]));
        Assert.False(Lyrics.HasWordTimings(Lines));
    }
}
