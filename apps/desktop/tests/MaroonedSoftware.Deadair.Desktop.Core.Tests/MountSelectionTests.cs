using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Choosing a mount from what the station published, and never by trying them.
/// </summary>
public class MountSelectionTests
{
    private static NowPlayingMount Mount(NowPlayingMountFormat format, string path, long? bitrate = null) =>
        new() { Format = format, Path = path, BitrateKbps = bitrate };

    [Fact]
    public void TakesTheFormatTheListenerAskedFor()
    {
        var mounts = new List<NowPlayingMount>
        {
            Mount(NowPlayingMountFormat.Mp3, "/live.mp3", 128),
            Mount(NowPlayingMountFormat.Flac, "/live.flac"),
        };

        var choice = MountSelection.Choose(mounts, NowPlayingMountFormat.Flac);

        Assert.Equal("/live.flac", choice.Path);
        Assert.False(choice.FellBack);
    }

    [Fact]
    public void FallsBackToMp3AndSaysSo()
    {
        // The operator switched FLAC off since this listener chose it. MP3 has no switch, so there is
        // always something to fall back to — and the listener is owed the fact that their choice was
        // not honoured, or they are left wondering why it sounds worse.
        var mounts = new List<NowPlayingMount> { Mount(NowPlayingMountFormat.Mp3, "/live.mp3", 128) };

        var choice = MountSelection.Choose(mounts, NowPlayingMountFormat.Flac);

        Assert.Equal("/live.mp3", choice.Path);
        Assert.True(choice.FellBack);
    }

    [Fact]
    public void AnswersTheDefaultPathWhenTheStationNamedNoMountsAtAll()
    {
        // The station says this cannot happen. If it does, guessing the one mount that is always
        // published beats refusing to play — and it is still a guess rather than a probe.
        var choice = MountSelection.Choose([], NowPlayingMountFormat.Mp3);

        Assert.Equal(MountSelection.DefaultMountPath, choice.Path);
        Assert.True(choice.FellBack);
    }

    [Fact]
    public void ChoosesHls_WhichIsAPlaylistRatherThanAnIcecastMount()
    {
        var mounts = new List<NowPlayingMount>
        {
            Mount(NowPlayingMountFormat.Mp3, "/live.mp3", 128),
            Mount(NowPlayingMountFormat.Hls, "/live.m3u8"),
        };

        var choice = MountSelection.Choose(mounts, NowPlayingMountFormat.Hls);

        Assert.Equal("/live.m3u8", choice.Path);
        Assert.False(choice.FellBack);
    }
}
