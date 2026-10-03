using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>
/// Who is presenting, in the line under the record.
/// </summary>
/// <remarks>
/// <para>
/// The Android app's words, so the two clients say the same thing about the same moment: "with Cass"
/// under a record, and "Cass is on the mic" during a break, which has no artist and whose own label is
/// already the title.
/// </para>
/// <para>
/// <b>A record with no name to give says nothing</b>, rather than "with the host": the station leaves
/// <c>show.host</c> out when nobody on air has an on-air name, and a line that names nobody is noise
/// under every record. A break is different, because the line is then the only thing saying the
/// station is talking rather than playing, so it falls back to "The host".
/// </para>
/// </remarks>
public static class HostLine
{
    /// <summary>The line, or null when there is nothing to say.</summary>
    public static string? For(NowPlayingTrack? track, NowPlayingShow? show)
    {
        if (track is null)
        {
            return null;
        }

        var host = string.IsNullOrWhiteSpace(show?.Host) ? null : show.Host.Trim();

        if (track.Kind is NowPlayingTrackKind.Break)
        {
            return host is null ? "The host is on the mic" : $"{host} is on the mic";
        }

        return host is null ? null : $"with {host}";
    }
}
