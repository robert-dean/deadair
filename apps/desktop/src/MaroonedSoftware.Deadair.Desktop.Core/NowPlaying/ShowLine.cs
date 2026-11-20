using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>
/// What the show on air is, in the line under the host.
/// </summary>
/// <remarks>
/// <para>
/// The station's <c>show.description</c>: the operator's own words for listeners, from the schedule slot the
/// broadcast belongs to. The Android and iOS apps draw it in the same place and on the same terms.
/// </para>
/// <para>
/// <b>Only under a record.</b> During a break the line under the title already says who is on the mic, and
/// off air there is no show to describe. Unlike the show's name, which the station makes up when nobody gave
/// one, this is only ever text somebody wrote for listeners, so it reads as a programme rather than software.
/// </para>
/// </remarks>
public static class ShowLine
{
    /// <summary>The line, or null when there is nothing to say.</summary>
    public static string? For(NowPlayingTrack? track, NowPlayingShow? show)
    {
        if (track is null || track.Kind is NowPlayingTrackKind.Break)
        {
            return null;
        }

        return string.IsNullOrWhiteSpace(show?.Description) ? null : show.Description.Trim();
    }
}
