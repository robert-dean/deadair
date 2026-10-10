using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class PlayheadTests
{
    private static readonly DateTimeOffset ReadAt = new(2026, 9, 7, 12, 0, 0, TimeSpan.Zero);

    private static NowPlayingTrack Track(long? durationMs, long? remainingMs) => new()
    {
        Title = "Jeremy",
        Artist = "Pearl Jam",
        StartedAt = 1_700_000_000_000,
        DurationMs = durationMs,
        RemainingMs = remainingMs,
    };

    [Fact]
    public void CountsForwardFromWhatTheStationSaidWasLeft()
    {
        var position = Playhead.Position(Track(300_000, 120_000), ReadAt, ReadAt.AddSeconds(5));

        // 300s long with 120s left is 180s in, plus the five seconds since the reading.
        Assert.Equal(TimeSpan.FromSeconds(185), position);
    }

    [Fact]
    public void RefusesToAnswerWhenTheDecoderCouldNotSay()
    {
        // The important case. `remainingMs` is absent when the station does not know, and the obvious
        // fallback — the clock minus `startedAt` — measures when the station STARTED the record, which
        // leads what a listener is hearing by the encoder and buffer and drifts with their connection.
        // A progress bar that is confidently wrong is worse than one that is absent.
        Assert.Null(Playhead.Position(Track(300_000, null), ReadAt, ReadAt.AddSeconds(5)));
    }

    [Fact]
    public void RefusesWhenThereIsNoLengthToBeAFractionOf()
    {
        Assert.Null(Playhead.Position(Track(null, 120_000), ReadAt, ReadAt.AddSeconds(5)));
        Assert.Null(Playhead.Position(Track(0, 120_000), ReadAt, ReadAt.AddSeconds(5)));
    }

    [Fact]
    public void AnswersNothingForAQuietStation()
    {
        Assert.Null(Playhead.Position(null, ReadAt, ReadAt));
        Assert.Null(Playhead.Duration(null));
    }

    [Fact]
    public void StopsAtTheEndRatherThanRunningPastIt()
    {
        // The next reading is a few seconds away at most, so a bar that overshoots to 103% is a more
        // obvious lie than one that sits at the end waiting for the boundary.
        var position = Playhead.Position(Track(300_000, 2_000), ReadAt, ReadAt.AddSeconds(30));

        Assert.Equal(TimeSpan.FromSeconds(300), position);
    }

    [Fact]
    public void CountsFromWhatIsAudible_WhenTheAnchorIsWhenTheListenerHearsTheReading()
    {
        // Anchored where the listener hears the reading, which is the hold's lead after the poll
        // answered. Two seconds after the poll the listener is still three seconds short of the
        // moment the station reported, so the bar is three seconds behind the station's figure.
        // Clamping that gap to zero held the bar at 180s until the next reading re-anchored it there.
        var heardAt = ReadAt.AddSeconds(5);
        var position = Playhead.Position(Track(300_000, 120_000), heardAt, ReadAt.AddSeconds(2));

        Assert.Equal(TimeSpan.FromSeconds(177), position);
    }

    [Fact]
    public void NeverAnswersBeforeTheStartOfTheRecord()
    {
        // A record a second old, anchored five seconds ahead: the listener is still in the record
        // before it, and a bar does not go below its own start.
        var position = Playhead.Position(Track(300_000, 299_000), ReadAt.AddSeconds(5), ReadAt);

        Assert.Equal(TimeSpan.Zero, position);
    }
}
