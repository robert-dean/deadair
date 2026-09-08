using System.Net;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Discovery;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>
/// The bytes BluOS players use to find each other.
///
/// The announce below is a real datagram from a NAD C388, which is the only thing that can settle a
/// wire format: the appendix describes the layout and a capture proves the reading of it. Everything
/// else here is about what happens when a datagram is not one of these, because this socket hears
/// whatever anything on the network felt like broadcasting.
/// </summary>
public sealed class LsdpPacketTests
{
    /// <summary>
    /// A real announce from a NAD C388: node 90:56:82:0e:1b:00 at 10.0.1.36, saying it is a player
    /// called SEALPLAYER on port 11000, and separately something else on port 11431.
    /// </summary>
    private const string CapturedAnnounce =
        "064c534450016a41069056820e1b00040a0001240200010504" +
        "6e616d650a5345414c504c4159455204706f72740531313030" +
        "30056d6f64656c04433338380776657273696f6e06332e3136" +
        "2e35027a730130000402046e616d650a5345414c504c415945" +
        "5204706f7274053131343331";

    [Fact]
    public void ReadsARealPlayersAnnouncement()
    {
        var announce = Assert.IsType<LsdpAnnounce>(Assert.Single(LsdpPacket.Parse(Bytes(CapturedAnnounce))));

        Assert.Equal("90:56:82:0e:1b:00", announce.NodeId);
        Assert.Equal(IPAddress.Parse("10.0.1.36"), announce.Address);
        Assert.Equal(2, announce.Records.Count);

        var player = announce.Records[0];
        Assert.Equal(LsdpPacket.PlayerClass, player.ClassId);
        Assert.Equal("SEALPLAYER", player.Text["name"]);
        Assert.Equal("11000", player.Text["port"]);
        Assert.Equal("C388", player.Text["model"]);
        Assert.Equal("3.16.5", player.Text["version"]);
        Assert.Equal("0", player.Text["zs"]);

        // A second class on the same node, which is not a player and is carried along without being
        // understood.
        Assert.Equal(0x0004, announce.Records[1].ClassId);
        Assert.Equal("11431", announce.Records[1].Text["port"]);
    }

    [Fact]
    public void BuildsTheQuestionAPlayerAnswers()
    {
        Assert.Equal("064c5344500105510100ff", Hex(LsdpPacket.Query(0x00FF)));
        Assert.Equal("064c53445001055101ffff", Hex(LsdpPacket.Query(LsdpPacket.AllClasses)));
        Assert.Equal("064c5344500105510100 01".Replace(" ", string.Empty, StringComparison.Ordinal), Hex(LsdpPacket.Query()));
    }

    /// <summary>
    /// Asking for the answer to come straight back rather than to the broadcast address. Worth
    /// having when the broadcast port could not be bound, which is what happens if the BluOS
    /// controller app on the same machine got there first.
    /// </summary>
    [Fact]
    public void CanAskForTheAnswerToComeStraightBack()
    {
        Assert.Equal("064c53445001055201 0001".Replace(" ", string.Empty, StringComparison.Ordinal), Hex(LsdpPacket.Query(unicastReply: true)));
    }

    [Fact]
    public void ReadsBackAQuestionItBuilt()
    {
        var query = Assert.IsType<LsdpQuery>(Assert.Single(LsdpPacket.Parse(LsdpPacket.Query(unicastReply: true))));

        Assert.True(query.UnicastReply);
        Assert.Equal(LsdpPacket.PlayerClass, Assert.Single(query.Classes));
    }

    /// <summary>
    /// Anything on a network may broadcast to any port, so most of what this socket hears is not
    /// LSDP at all. None of it is an error worth reporting; it is simply not an announcement.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("00")]
    [InlineData("064e4f5045 01")]
    [InlineData("48656c6c6f2c20776f726c64")]
    public void SomethingThatIsNotThisProtocolIsSimplyNotAnAnnouncement(string hex)
    {
        Assert.Empty(LsdpPacket.Parse(Bytes(hex)));
    }

    /// <summary>
    /// A datagram cut short stops the reading and keeps whatever came before it, because without a
    /// whole length there is no way to find where the next message starts.
    /// </summary>
    [Fact]
    public void ATruncatedDatagramKeepsWhatWasReadableBeforeTheCut()
    {
        var whole = Bytes(CapturedAnnounce);
        var cut = whole[..(whole.Length - 20)];

        // The announce's own length no longer fits, so nothing is returned rather than a device with
        // half its facts.
        Assert.Empty(LsdpPacket.Parse(cut));
    }

    /// <summary>
    /// A message type this plugin does not know is skipped by its own length, which is what a length
    /// on every message is for: the messages after it are still read.
    /// </summary>
    [Fact]
    public void AMessageTypeThisPluginDoesNotKnowDoesNotHideTheOnesAfterIt()
    {
        // A header, a five-byte message of type 'Z', then a query.
        var packet = Bytes("064c53445001" + "055a0100ff").Concat(Bytes("055101ffff")).ToArray();

        var query = Assert.IsType<LsdpQuery>(Assert.Single(LsdpPacket.Parse(packet)));
        Assert.Equal(LsdpPacket.AllClasses, Assert.Single(query.Classes));
    }

    [Fact]
    public void ReadsANodeSayingItHasGone()
    {
        // A header, then [len][D][6 bytes of node][one class][class 1].
        var packet = Bytes("064c53445001" + "0c44" + "069056820e1b00" + "01" + "0001");

        var gone = Assert.IsType<LsdpDelete>(Assert.Single(LsdpPacket.Parse(packet)));

        Assert.Equal("90:56:82:0e:1b:00", gone.NodeId);
        Assert.Equal(LsdpPacket.PlayerClass, Assert.Single(gone.Classes));
    }

    private static byte[] Bytes(string hex) =>
        Convert.FromHexString(hex.Replace(" ", string.Empty, StringComparison.Ordinal));

    private static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();
}
