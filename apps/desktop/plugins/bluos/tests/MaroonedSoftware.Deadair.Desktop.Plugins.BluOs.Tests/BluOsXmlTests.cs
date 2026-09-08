using System.Xml;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>
/// Reading what a player answered.
///
/// Against files rather than strings written here, and the files are what a real player really sent
/// wherever that was measured. Anything guessed says so in its own comment, and the spike is what
/// settles it.
/// </summary>
public sealed class BluOsXmlTests
{
    [Fact]
    public void ReadsAPlayerStreamingTheStation()
    {
        var status = BluOsXml.ParseStatus(Fixture("status-stream.xml"));

        Assert.Equal("4e8b1a2c", status.Etag);
        Assert.Equal("stream", status.State);
        Assert.Equal(692, status.Secs);
        Assert.Equal(18, status.Volume);
        Assert.Equal("TuneIn:https://radio.deanhome.app/live.mp3", status.StreamUrl);
        Assert.Equal("TuneIn", status.Service);
        Assert.Equal("Deadair", status.Title1);

        // One flattened line, which is the permanent ceiling for a station added as a custom URL:
        // Icecast composes it out of the title and artist and there is no second field on the wire.
        Assert.Equal("Warren G, Nate Dogg - Regulate", status.Title2);
    }

    [Fact]
    public void ReadsAPlayerThatIsStillConnecting()
    {
        var status = BluOsXml.ParseStatus(Fixture("status-connecting.xml"));

        Assert.Equal("connecting", status.State);
        Assert.Equal(0, status.Secs);

        // Present here, which the earlier probe had never seen and the spike measured: the player
        // names the mount from the moment it is asked for it, not from the moment it plays it.
        Assert.Equal("https://radio.deanhome.app/live.mp3", status.StreamUrl);
    }

    [Fact]
    public void ReadsAPlayerPlayingSomethingElse()
    {
        var status = BluOsXml.ParseStatus(Fixture("status-another-source.xml"));

        Assert.Equal("pause", status.State);
        Assert.Equal("Deezer:142986206", status.StreamUrl);
        Assert.Equal(4, status.Volume);
    }

    /// <summary>
    /// A player that did not say how loud it is has not said it is silent, so a missing element is
    /// missing rather than zero.
    /// </summary>
    [Fact]
    public void SomethingTheAnswerDidNotMentionIsAbsentRatherThanZero()
    {
        var status = BluOsXml.ParseStatus(Fixture("status-quiet.xml"));

        Assert.Equal("stop", status.State);
        Assert.Null(status.Secs);
        Assert.Null(status.StreamUrl);
        Assert.Null(status.Title2);
    }

    [Fact]
    public void ReadsWhatAPlayerSaysItIs()
    {
        var sync = BluOsXml.ParseSyncStatus(Fixture("syncstatus.xml"));

        Assert.Equal("Office", sync.Name);
        Assert.Equal("NAD", sync.Brand);
        Assert.Equal("M10v2", sync.Model);
        Assert.Equal("M10 V2", sync.ModelName);
        Assert.Equal(20, sync.Volume);

        // Upper case here and lower in the LSDP announcement, from the same player. Anything that
        // ever compared the two would have to fold the case first; the device's id comes from LSDP.
        Assert.Equal("90:56:82:00:BC:99", sync.Mac);
    }

    [Fact]
    public void ReadsTheAnswerToPlayAndStop()
    {
        Assert.Equal("stream", BluOsXml.ParseState(Fixture("state.xml")));

        // The same word arrives nested in a /Status, and both are read the same way.
        Assert.Equal("stream", BluOsXml.ParseState(Fixture("status-stream.xml")));
    }

    [Fact]
    public void ReadsTheVolumeFromItsOwnElementsText()
    {
        Assert.Equal(18, BluOsXml.ParseVolume(Fixture("volume.xml")));
    }

    /// <summary>
    /// A player whose volume is fixed answers -1, which is "there is no volume here" and not "it is
    /// silent". Reading it as a level would draw a slider at the bottom of its travel and invite
    /// somebody to drag it.
    /// </summary>
    [Fact]
    public void AFixedVolumeIsMinusOneAndIsNotSilence()
    {
        Assert.Equal(-1, BluOsXml.ParseVolume(Fixture("volume-fixed.xml")));
    }

    /// <summary>
    /// The parser is pointed at whatever answered on the local network, which is exactly where a
    /// document type definition turns a parse into a fetch this app never intended.
    /// </summary>
    [Fact]
    public void RefusesADocumentTypeDefinition()
    {
        Assert.Throws<XmlException>(() => BluOsXml.ParseStatus(Fixture("status-with-a-doctype.xml")));
    }

    [Fact]
    public void SomethingThatIsNotXmlAtAllThrowsRatherThanAnswersNonsense()
    {
        Assert.Throws<XmlException>(() => BluOsXml.ParseStatus("<status"));
    }

    /// <summary>
    /// The same player reached the other way. Handed a mount by this plugin it answers with the bare
    /// URL and a service of `https`; added through the controller app it answers with a TuneIn
    /// prefix. Both have to read as the station.
    /// </summary>
    [Fact]
    public void ReadsAPlayerThisPluginStartedRatherThanTheControllerApp()
    {
        var status = BluOsXml.ParseStatus(Fixture("status-stream-measured.xml"));

        Assert.Equal("stream", status.State);
        Assert.Equal("https", status.Service);
        Assert.Equal("https://radio.deanhome.app/live.mp3", status.StreamUrl);
        Assert.Equal(7, status.Secs);
    }

    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
