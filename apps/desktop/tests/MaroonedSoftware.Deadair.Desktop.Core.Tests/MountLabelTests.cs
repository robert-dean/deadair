using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public sealed class MountLabelTests
{
    private static NowPlayingMount Mount(NowPlayingMountFormat format, int? bitrate = null) =>
        new() { Format = format, Path = "/live", BitrateKbps = bitrate };

    [Fact]
    public void NamesTheFormatAndTheRate()
    {
        Assert.Equal("MP3 128 kb/s", MountLabel.Of(Mount(NowPlayingMountFormat.Mp3, 128)));
    }

    [Fact]
    public void NamesFlacByFormatAlone()
    {
        // Lossless has no rate to set, so the absent bitrate is the contract rather than a gap, and
        // drawing it as one would be inventing a fact.
        Assert.Equal("FLAC", MountLabel.Of(Mount(NowPlayingMountFormat.Flac)));
    }

    [Fact]
    public void NamesHlsByFormatAlone()
    {
        // A master playlist's rate belongs to whichever variant is playing, which this cannot know.
        Assert.Equal("HLS", MountLabel.Of(Mount(NowPlayingMountFormat.Hls)));
    }

    [Fact]
    public void WritesEachFormatTheWayAListenerWouldRatherThanTheWayTheWireSpellsIt()
    {
        Assert.Equal("MP3", MountLabel.Name(NowPlayingMountFormat.Mp3));
        Assert.Equal("Opus", MountLabel.Name(NowPlayingMountFormat.Opus));
        Assert.Equal("AAC", MountLabel.Name(NowPlayingMountFormat.Aac));
        Assert.Equal("FLAC", MountLabel.Name(NowPlayingMountFormat.Flac));
        Assert.Equal("HLS", MountLabel.Name(NowPlayingMountFormat.Hls));
    }
}
