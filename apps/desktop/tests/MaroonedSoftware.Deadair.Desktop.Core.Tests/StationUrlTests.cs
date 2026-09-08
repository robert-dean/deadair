using MaroonedSoftware.Deadair.Desktop.Core.Station;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Turning what somebody typed into the three addresses the app actually uses.
/// </summary>
public class StationUrlTests
{
    private static StationUrl Parse(string text)
    {
        Assert.True(StationUrl.TryParse(text, out var station), $"expected {text} to parse");
        return station;
    }

    [Theory]
    [InlineData("radio.example.com")]
    [InlineData("https://radio.example.com")]
    [InlineData("https://radio.example.com/")]
    [InlineData("  https://radio.example.com/console  ")]
    public void ReadsAnAddressHoweverItWasTyped(string typed)
    {
        // A bare host gets https, and a path is dropped: only the origin means anything, and somebody
        // who pasted the address of a page they were looking at should not have to trim it.
        Assert.Equal("https://radio.example.com", Parse(typed).ToString());
    }

    [Fact]
    public void LeavesAnExplicitHttpAlone()
    {
        // A station on a LAN is a real case. Upgrading it silently leaves somebody with an app that
        // cannot connect and no way to see why.
        Assert.Equal("http://192.168.1.50:8000", Parse("http://192.168.1.50:8000").ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("ftp://radio.example.com")]
    [InlineData("not a url")]
    public void RefusesWhatIsNotAnAddress(string typed) =>
        Assert.False(StationUrl.TryParse(typed, out _));

    [Fact]
    public void PutsTheApiUnderTheApiPrefixAndTheMountsOutsideIt()
    {
        var station = Parse("https://radio.example.com");

        // The edge strips `/api` before the station sees a request, and the mounts are not behind it.
        // Getting this the wrong way round produces a client that can read the API and never play, or
        // one that can play and never read, which is why they are one type's responsibility.
        Assert.Equal("https://radio.example.com/api", station.ApiBase);
        Assert.Equal("https://radio.example.com/live.mp3", station.MountUrl("/live.mp3").ToString());
        Assert.Equal("https://radio.example.com/live.m3u8", station.MountUrl("live.m3u8").ToString());
    }

    [Fact]
    public void ResolvesTheStationsOwnArtAndPassesAProvidersThrough()
    {
        var station = Parse("https://radio.example.com");

        // Two shapes from one field: relative once the station holds its own copy, absolute while the
        // art is still the provider's.
        Assert.Equal(
            "https://radio.example.com/api/art/2f6c1e9a-0000-4000-8000-000000000001",
            station.ArtUrl("art/2f6c1e9a-0000-4000-8000-000000000001")!.ToString());
        Assert.Equal(
            "https://i.example.net/cover.jpg",
            station.ArtUrl("https://i.example.net/cover.jpg")!.ToString());
        Assert.Null(station.ArtUrl(null));
        Assert.Null(station.ArtUrl("  "));
    }

    [Fact]
    public void KeepsAPortAndAPathPrefixedHostApart()
    {
        Assert.Equal("http://localhost:5173", Parse("http://localhost:5173/desk").ToString());
    }
}
