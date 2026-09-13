using MaroonedSoftware.Deadair.Desktop.Core.Station;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class StationLinkTests
{
    [Theory]
    [InlineData("deadair://connect?station=https%3A%2F%2Fradio.example.com", "https://radio.example.com")]
    [InlineData("deadair://connect?station=http%3A%2F%2F192.168.1.50%3A8000", "http://192.168.1.50:8000")]
    [InlineData("deadair://connect/?station=https%3A%2F%2Fradio.example.com", "https://radio.example.com")]
    [InlineData("deadair://connect?from=console&station=https%3A%2F%2Fradio.example.com", "https://radio.example.com")]
    [InlineData("deadair://connect?station=https%3A%2F%2Fradio.example.com&from=console", "https://radio.example.com")]
    [InlineData("DEADAIR://connect?station=https%3A%2F%2Fradio.example.com", "https://radio.example.com")]
    public void ReadsTheStationTheConsoleWrites(string link, string expected)
    {
        Assert.True(StationLink.TryParse(link, out var station));
        Assert.Equal(expected, station.ToString());
    }

    /// <summary>
    /// The only form that can name a plain-http station, which is where most of these run: the
    /// shorthand below would make it https and point the app at nothing.
    /// </summary>
    [Fact]
    public void KeepsAPlainHttpStationPlain()
    {
        Assert.True(StationLink.TryParse("deadair://connect?station=http%3A%2F%2Fradio.local", out var station));
        Assert.Equal("http", station.Origin.Scheme);
    }

    [Theory]
    [InlineData("deadair://radio.example.com", "https://radio.example.com")]
    [InlineData("deadair://radio.example.com/", "https://radio.example.com")]
    [InlineData("deadair://radio.example.com:8443", "https://radio.example.com:8443")]
    public void ReadsTheShorthandAsHttps(string link, string expected)
    {
        Assert.True(StationLink.TryParse(link, out var station));
        Assert.Equal(expected, station.ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("https://radio.example.com")]
    [InlineData("deadair://connect")]
    [InlineData("deadair://connect?station=")]
    [InlineData("deadair://connect?other=1")]
    [InlineData("deadair://connect?station=ftp%3A%2F%2Fradio.example.com")]
    [InlineData("deadair://radio.example.com/some/path")]
    [InlineData("deadair://radio.example.com?station=https%3A%2F%2Felsewhere.example.com")]
    [InlineData("not a link")]
    public void RefusesAnythingElse(string? link)
    {
        Assert.False(StationLink.TryParse(link, out _));
    }
}
