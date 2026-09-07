using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>Which mount was chosen, and whether it was the one asked for.</summary>
/// <param name="Path">The station's own path, leading slash included. Not a URL: it is resolved
/// against whatever origin answered, never against the address the app was configured with.</param>
/// <param name="Format">What it turned out to be.</param>
/// <param name="FellBack">
/// True when the wanted format was not on offer. Worth surfacing quietly: an operator who switched
/// FLAC on and is hearing MP3 should be able to find out why without reading a log.
/// </param>
public readonly record struct MountChoice(string Path, NowPlayingMountFormat Format, bool FellBack);

/// <summary>
/// Choosing how to listen, from what the station says it is publishing.
/// </summary>
/// <remarks>
/// <para>
/// The whole of this is "read <c>mounts[]</c>", and the reason it is worth a type is the thing it
/// must never do: <b>probe</b>. Connecting to a mount for any length of time registers an audience
/// for a five-minute linger, so a format picker that tried each mount to see which answered would
/// put a silent, audience-gated station on air for five minutes every time somebody opened it.
/// <c>GET /nowplaying</c> carries the list for exactly this reason.
/// </para>
/// <para>
/// MP3 is the floor because it has no switch: the station always publishes it, so there is always
/// something to fall back to.
/// </para>
/// </remarks>
public static class MountSelection
{
    /// <summary>What to play before the station has been asked anything.</summary>
    /// <remarks>
    /// Only for the first moments after a station address is entered, when no reading has arrived.
    /// It is a guess at the one mount that is always published, and it is replaced by a real answer
    /// as soon as one exists.
    /// </remarks>
    public const string DefaultMountPath = "/live.mp3";

    public static MountChoice Choose(IReadOnlyList<NowPlayingMount> mounts, NowPlayingMountFormat wanted)
    {
        ArgumentNullException.ThrowIfNull(mounts);

        foreach (var mount in mounts)
        {
            if (mount.Format == wanted)
            {
                return new MountChoice(mount.Path, mount.Format, FellBack: false);
            }
        }

        foreach (var mount in mounts)
        {
            if (mount.Format == NowPlayingMountFormat.Mp3)
            {
                return new MountChoice(mount.Path, mount.Format, FellBack: true);
            }
        }

        // Neither the wanted format nor the floor. The station says this cannot happen — MP3 has no
        // switch — so this arm is reached only by a station that answered something impossible, and
        // guessing the default path is a better answer than refusing to play at all.
        if (mounts.Count > 0)
        {
            var first = mounts[0];
            return new MountChoice(first.Path, first.Format, FellBack: true);
        }

        return new MountChoice(DefaultMountPath, NowPlayingMountFormat.Mp3, FellBack: true);
    }
}
