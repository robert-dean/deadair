using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>
/// Reading this plugin's settings, which arrive as text because every layer of this station's
/// configuration is text.
/// </summary>
public sealed class BluOsConfigTests
{
    [Theory]
    [InlineData("10.0.1.36", "10.0.1.36", 11000)]
    [InlineData("10.0.1.36:11010", "10.0.1.36", 11010)]
    [InlineData("kitchen.local", "kitchen.local", 11000)]
    [InlineData("  kitchen.local:11000  ", "kitchen.local", 11000)]
    public void ReadsAnAddressWithOrWithoutAPort(string text, string host, int port)
    {
        var endpoint = BluOsEndpoint.Parse(text);

        Assert.Equal(host, endpoint.Host);
        Assert.Equal(port, endpoint.Port);
    }

    [Theory]
    [InlineData("10.0.1.36:")]
    [InlineData("10.0.1.36:nope")]
    [InlineData("10.0.1.36:0")]
    [InlineData("10.0.1.36:99999")]
    [InlineData(":11000")]
    public void RefusesSomethingThatIsNotAnAddress(string text)
    {
        Assert.Throws<FormatException>(() => BluOsEndpoint.Parse(text));
    }

    /// <summary>
    /// Always written with the port, even the default one, so a remembered device does not change
    /// meaning if that default ever does.
    /// </summary>
    [Fact]
    public void WritesItselfWithThePortAndBuildsAPlainHttpAddress()
    {
        var endpoint = new BluOsEndpoint("10.0.1.36");

        Assert.Equal("10.0.1.36:11000", endpoint.ToString());
        Assert.Equal("http://10.0.1.36:11000/", endpoint.BaseAddress.ToString());
    }

    /// <summary>
    /// A text box invites lines, and a habit of commas. Neither is worth correcting somebody about.
    /// </summary>
    [Fact]
    public void ReadsPlayersOnePerLineOrPerComma()
    {
        var settings = Read(new()
        {
            ["players"] = "10.0.1.36, kitchen.local:11010\n10.0.1.40\n\n  10.0.1.40  ",
        });

        Assert.Equal(3, settings.Players.Count);
        Assert.Equal(new BluOsEndpoint("10.0.1.36"), settings.Players[0]);
        Assert.Equal(new BluOsEndpoint("kitchen.local", 11010), settings.Players[1]);
        Assert.Equal(new BluOsEndpoint("10.0.1.40"), settings.Players[2]);
    }

    /// <summary>
    /// A typo in the third of four addresses costs the operator that address, not the plugin. They
    /// still get the three players they typed correctly, and a line in the log about the fourth.
    /// </summary>
    [Fact]
    public void OneUnreadableAddressDoesNotCostTheOthers()
    {
        var settings = Read(new() { ["players"] = "10.0.1.36\n:::\n10.0.1.40" });

        Assert.Equal(2, settings.Players.Count);
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("True", true)]
    [InlineData("1", true)]
    [InlineData("yes", true)]
    [InlineData("on", true)]
    [InlineData("false", false)]
    [InlineData("0", false)]
    [InlineData("no", false)]
    [InlineData("off", false)]
    public void ReadsAnOnOffSettingAsTheStationWritesOne(string text, bool expected)
    {
        Assert.Equal(expected, Read(new() { ["discover"] = text }).Discover);
    }

    /// <summary>
    /// A value nobody can read is a value nobody set, so it takes the declared default rather than
    /// falling to off. Falling to off would mean a mistyped setting quietly switching discovery
    /// away, which looks exactly like a network that has stopped answering.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("perhaps")]
    public void SomethingUnreadableTakesTheDeclaredDefault(string text)
    {
        Assert.True(Read(new() { ["discover"] = text }).Discover);
    }

    [Fact]
    public void ADefaultAppliesWhenTheFieldIsNotThereAtAll()
    {
        var settings = Read([]);

        Assert.True(settings.Discover);
        Assert.Empty(settings.Players);
        Assert.Null(settings.Caption);
        Assert.Null(settings.Logo);
    }

    [Fact]
    public void ReadsTheCaptionAndTheLogo()
    {
        var settings = Read(new()
        {
            ["caption"] = "  Deadair  ",
            ["logo"] = "https://radio.example.com/logo.png",
        });

        Assert.Equal("Deadair", settings.Caption);
        Assert.Equal(new Uri("https://radio.example.com/logo.png"), settings.Logo);
    }

    /// <summary>
    /// A player fetches the logo over the network, so anything it could not fetch is dropped rather
    /// than sent for the device to fail on. A bare path is the case worth having a test for: on a
    /// Unix host it parses happily as an absolute FILE address, and would otherwise be handed to a
    /// speaker as though it were a real one.
    /// </summary>
    [Theory]
    [InlineData("/logo.png")]
    [InlineData("logo.png")]
    [InlineData("file:///Users/somebody/logo.png")]
    public void ALogoAPlayerCouldNotFetchIsIgnored(string text)
    {
        Assert.Null(Read(new() { ["logo"] = text }).Logo);
    }

    private static BluOsSettings Read(Dictionary<string, string> values) => BluOsConfig.Read(values);
}
