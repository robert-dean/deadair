using System.Globalization;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// How a mount names itself on screen.
/// </summary>
/// <remarks>
/// The bitrate is absent for two formats and the contract says why: FLAC is lossless and has no rate
/// to set, and HLS is a master playlist whose rate belongs to whichever variant is playing. So this
/// is not "a number that happened to be missing" and must never be drawn as one — those two are
/// named by format alone.
/// </remarks>
public static class MountLabel
{
    public static string Of(NowPlayingMount mount)
    {
        ArgumentNullException.ThrowIfNull(mount);

        var format = Name(mount.Format);

        return mount.BitrateKbps is { } rate and > 0
            ? string.Create(CultureInfo.CurrentCulture, $"{format} {rate} kb/s")
            : format;
    }

    /// <summary>The format alone, as a listener would write it rather than as the wire spells it.</summary>
    public static string Name(NowPlayingMountFormat format) => format switch
    {
        NowPlayingMountFormat.Mp3 => "MP3",
        NowPlayingMountFormat.Opus => "Opus",
        NowPlayingMountFormat.Aac => "AAC",
        NowPlayingMountFormat.Flac => "FLAC",
        NowPlayingMountFormat.Hls => "HLS",
        _ => format.ToString().ToUpperInvariant(),
    };
}
