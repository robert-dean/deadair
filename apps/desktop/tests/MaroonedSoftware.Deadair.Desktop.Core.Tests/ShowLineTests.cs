using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class ShowLineTests
{
    private static NowPlayingTrack Record() => new() { Title = "Jeremy", Artist = "Pearl Jam", StartedAt = 1_700_000_000_000 };

    private static NowPlayingTrack Break() => new()
    {
        Kind = NowPlayingTrackKind.Break,
        Title = "Talk break",
        Artist = string.Empty,
        StartedAt = 1_700_000_000_000,
    };

    private static NowPlayingShow Show(string? description) => new() { Name = "Late Static", Host = "Cass", Description = description };

    [Fact]
    public void SaysWhatTheShowIsUnderARecord() =>
        Assert.Equal("Soul for the small hours.", ShowLine.For(Record(), Show(" Soul for the small hours. ")));

    [Fact]
    public void SaysNothingDuringABreakOffAirOrForAShowWithNoDescription()
    {
        Assert.Null(ShowLine.For(Break(), Show("Soul for the small hours.")));
        Assert.Null(ShowLine.For(null, Show("Soul for the small hours.")));
        Assert.Null(ShowLine.For(Record(), Show("  ")));
        Assert.Null(ShowLine.For(Record(), Show(null)));
        Assert.Null(ShowLine.For(Record(), null));
    }
}
