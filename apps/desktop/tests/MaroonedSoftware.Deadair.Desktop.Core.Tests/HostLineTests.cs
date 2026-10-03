using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class HostLineTests
{
    private static NowPlayingTrack Record() => new() { Title = "Jeremy", Artist = "Pearl Jam", StartedAt = 1_700_000_000_000 };

    private static NowPlayingTrack Break() => new()
    {
        Kind = NowPlayingTrackKind.Break,
        Title = "Talk break",
        Artist = string.Empty,
        StartedAt = 1_700_000_000_000,
    };

    private static NowPlayingShow Show(string? host) => new() { Name = "Late Static", Host = host };

    [Fact]
    public void NamesWhoBroughtTheRecord() => Assert.Equal("with Cass", HostLine.For(Record(), Show("Cass")));

    [Fact]
    public void SaysNothingUnderARecordWhenThereIsNobodyToName()
    {
        // "with the host" under every record would be noise; the station leaves host out on purpose.
        Assert.Null(HostLine.For(Record(), Show(null)));
        Assert.Null(HostLine.For(Record(), Show("  ")));
        Assert.Null(HostLine.For(Record(), null));
    }

    [Fact]
    public void ABreakIsSomebodyOnTheMic() => Assert.Equal("Cass is on the mic", HostLine.For(Break(), Show(" Cass ")));

    [Fact]
    public void ABreakWithNoNameStillSaysTheStationIsTalking() =>
        Assert.Equal("The host is on the mic", HostLine.For(Break(), null));

    [Fact]
    public void OffAirSaysNothing() => Assert.Null(HostLine.For(null, Show("Cass")));
}
