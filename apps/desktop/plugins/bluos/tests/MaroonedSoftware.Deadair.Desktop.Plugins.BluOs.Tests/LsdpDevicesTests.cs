using System.Net;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Discovery;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>Turning what players said about themselves into devices somebody can choose.</summary>
public sealed class LsdpDevicesTests
{
    [Fact]
    public void ReadsAPlayersNameModelAndPort()
    {
        var device = Assert.Single(LsdpDevices.From([Player("90:56:82:0a:1b:0d", "192.0.2.36", "Living Room", "M10V2", "11000")], "deadair.bluos"));

        Assert.Equal("90:56:82:0a:1b:0d", device.Id);
        Assert.Equal("Living Room", device.Name);
        Assert.Equal("M10V2", device.Model);
        Assert.Equal("192.0.2.36:11000", device.Address);
    }

    /// <summary>
    /// A query is sent more than once because UDP loses things, so one player usually answers
    /// several times. It is one device.
    /// </summary>
    [Fact]
    public void ThreeAnswersFromOnePlayerAreOnePlayer()
    {
        var announce = Player("90:56:82:0a:1b:0d", "192.0.2.36", "Living Room", "M10V2", "11000");

        Assert.Single(LsdpDevices.From([announce, announce, announce], "deadair.bluos"));
    }

    /// <summary>
    /// A player that moved between two answers is at the address it gave most recently, which is the
    /// only one of the two that is still true.
    /// </summary>
    [Fact]
    public void APlayerThatMovedIsWhereItSaidLast()
    {
        var devices = LsdpDevices.From(
            [
                Player("90:56:82:0a:1b:0d", "192.0.2.36", "Living Room", "M10V2", "11000"),
                Player("90:56:82:0a:1b:0d", "192.0.2.44", "Living Room", "M10V2", "11000"),
            ],
            "deadair.bluos");

        Assert.Equal("192.0.2.44:11000", Assert.Single(devices).Address);
    }

    /// <summary>
    /// Every player is on 11000 except a CI580, whose four zones are on 11000, 11010, 11020 and
    /// 11030. That is the whole reason a discovered player carries a port rather than assuming one.
    /// </summary>
    [Fact]
    public void APlayerOnAnotherPortIsRememberedAtIt()
    {
        var device = Assert.Single(LsdpDevices.From([Player("aa:bb:cc:dd:ee:ff", "192.0.2.50", "Zone 3", "CI580", "11020")], "deadair.bluos"));

        Assert.Equal("192.0.2.50:11020", device.Address);
    }

    [Fact]
    public void APortThatMakesNoSenseFallsBackToTheUsualOne()
    {
        var device = Assert.Single(LsdpDevices.From([Player("aa:bb:cc:dd:ee:ff", "192.0.2.50", "Odd one", "X", "not a port")], "deadair.bluos"));

        Assert.Equal("192.0.2.50:11000", device.Address);
    }

    /// <summary>
    /// A zone of a multi-zone player announces itself too, and a zone is not somewhere this app can
    /// send a station.
    /// </summary>
    [Fact]
    public void SomethingThatIsNotAPlayerIsNotOffered()
    {
        var announce = new LsdpAnnounce(
            "90:56:82:0a:1b:0e",
            IPAddress.Parse("192.0.2.37"),
            [new LsdpRecord(LsdpPacket.SecondaryPlayerClass, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["name"] = "Zone 2" })]);

        Assert.Empty(LsdpDevices.From([announce], "deadair.bluos"));
    }

    /// <summary>
    /// A picker row has to say something, and a player somebody can reach is worth listing under its
    /// address rather than leaving out.
    /// </summary>
    [Fact]
    public void APlayerThatDidNotSayItsNameIsListedUnderItsAddress()
    {
        var announce = new LsdpAnnounce(
            "90:56:82:0a:1b:0f",
            IPAddress.Parse("192.0.2.38"),
            [new LsdpRecord(LsdpPacket.PlayerClass, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase))]);

        var device = Assert.Single(LsdpDevices.From([announce], "deadair.bluos"));

        Assert.Equal("192.0.2.38", device.Name);
        Assert.Null(device.Model);
    }

    [Fact]
    public void PlayersComeBackInAnOrderSomebodyCanReadDownAList()
    {
        var devices = LsdpDevices.From(
            [
                Player("00:00:00:00:00:01", "192.0.2.10", "Study", "N130", "11000"),
                Player("00:00:00:00:00:02", "192.0.2.11", "Bedroom", "N130", "11000"),
            ],
            "deadair.bluos");

        Assert.Equal("Bedroom", devices[0].Name);
        Assert.Equal("Study", devices[1].Name);
    }

    private static LsdpAnnounce Player(string node, string address, string name, string model, string port) =>
        new(node, IPAddress.Parse(address),
        [
            new LsdpRecord(LsdpPacket.PlayerClass, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["name"] = name,
                ["model"] = model,
                ["port"] = port,
            }),
        ]);
}
