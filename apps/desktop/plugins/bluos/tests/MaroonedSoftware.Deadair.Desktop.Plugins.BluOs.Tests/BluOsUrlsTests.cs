using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>
/// The requests this plugin makes.
///
/// The escaping is the whole point. A mount is a URL inside a URL, and a colon or a slash left raw
/// truncates the address the player is given: the request succeeds, the player plays nothing, and
/// nothing anywhere says why.
/// </summary>
public sealed class BluOsUrlsTests
{
    private static readonly BluOsEndpoint Player = new("10.0.1.36");
    private static readonly Uri Mount = new("https://radio.deanhome.app/live.mp3");

    [Fact]
    public void AMountIsEscapedIntoTheQueryAndComesBackOutWhole()
    {
        var url = BluOsUrls.Play(Player, Mount);

        Assert.StartsWith("http://10.0.1.36:11000/Play?url=", url.ToString(), StringComparison.Ordinal);

        var escaped = url.Query["?url=".Length..];
        Assert.DoesNotContain("/", escaped, StringComparison.Ordinal);
        Assert.DoesNotContain(":", escaped, StringComparison.Ordinal);
        Assert.Equal(Mount.ToString(), Uri.UnescapeDataString(escaped));
    }

    [Fact]
    public void AMountWithAQueryOfItsOwnSurvives()
    {
        var mount = new Uri("https://radio.deanhome.app/live.mp3?token=a&b=c");

        var url = BluOsUrls.Play(Player, mount);

        Assert.Equal(mount.ToString(), Uri.UnescapeDataString(url.Query["?url=".Length..]));
    }

    /// <summary>
    /// The caption goes in the same query as the address, so an ampersand in a station's name would
    /// otherwise end the caption and start an argument nobody meant to send.
    /// </summary>
    [Fact]
    public void ACaptionWithAnAmpersandDoesNotBecomeASecondArgument()
    {
        var url = BluOsUrls.Play(Player, Mount, "Marla & Robert's station", new Uri("https://radio.deanhome.app/logo.png"));

        var arguments = url.Query.TrimStart('?').Split('&');
        Assert.Equal(3, arguments.Length);

        var title = arguments.Single(argument => argument.StartsWith("title1=", StringComparison.Ordinal));
        Assert.Equal("Marla & Robert's station", Uri.UnescapeDataString(title["title1=".Length..]));
    }

    [Fact]
    public void ACaptionAndALogoAreLeftOutWhenThereAreNone()
    {
        var url = BluOsUrls.Play(Player, Mount);

        Assert.DoesNotContain("title1", url.Query, StringComparison.Ordinal);
        Assert.DoesNotContain("image", url.Query, StringComparison.Ordinal);
    }

    /// <summary>
    /// Never Pause. A paused player holds the connection open and is still an audience, so pausing
    /// would leave an audience-gated station broadcasting to a room where somebody pressed stop.
    /// </summary>
    [Fact]
    public void StoppingIsStoppingAndNotPausing()
    {
        Assert.Equal("http://10.0.1.36:11000/Stop", BluOsUrls.Stop(Player).ToString());
    }

    [Fact]
    public void AsksForTheStatusPlainlyOrWaitsForAChange()
    {
        Assert.Equal("http://10.0.1.36:11000/Status", BluOsUrls.Status(Player).ToString());
        Assert.Equal("http://10.0.1.36:11000/Status?etag=4e8b1a2c&timeout=60", BluOsUrls.Status(Player, "4e8b1a2c", 60).ToString());
    }

    [Fact]
    public void ReadsAndSetsTheVolume()
    {
        Assert.Equal("http://10.0.1.36:11000/Volume", BluOsUrls.Volume(Player).ToString());
        Assert.Equal("http://10.0.1.36:11000/Volume?level=0", BluOsUrls.Volume(Player, 0).ToString());
        Assert.Equal("http://10.0.1.36:11000/Volume?level=100", BluOsUrls.Volume(Player, 100).ToString());
    }

    /// <summary>
    /// Every player is on 11000 except a CI580, whose four zones are on 11000, 11010, 11020 and
    /// 11030, and which is why discovery reports a port at all.
    /// </summary>
    [Fact]
    public void APlayerOnAnotherPortIsAskedThere()
    {
        Assert.Equal(
            "http://10.0.1.40:11020/SyncStatus",
            BluOsUrls.SyncStatus(new BluOsEndpoint("10.0.1.40", 11020)).ToString());
    }
}
