using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>
/// Where the presenter's picture goes: beside their line, or in the cover's square during a break.
/// </summary>
/// <remarks>
/// <para>
/// <c>show.hostArtUrl</c> is a path under the API root, the same shape as a record's
/// <c>artworkUrl</c>, so both answers here are UNRESOLVED and go through <c>StationUrl.ArtUrl</c> like
/// every cover does. It is absent for a persona with no picture and from a station older than the
/// field, and then every answer is exactly what it was before the field existed.
/// </para>
/// <para>
/// <b>A break takes the portrait as its cover.</b> A break has no art of its own, so the square drew
/// the break label's initial, which says nothing. The person talking is the honest picture of that
/// moment. A record keeps its own cover, and a record with none keeps its initial: the record is
/// still what is on air, and the presenter is who brought it.
/// </para>
/// <para>
/// <b>The portrait goes beside the line only where the line is drawn</b>, so a record with nobody to
/// name shows no stray picture, and never when the cover beside it already IS the portrait: the same
/// face twice, a few units apart, is once too many.
/// </para>
/// </remarks>
public static class HostPortrait
{
    /// <summary>The picture for the cover's square, unresolved: the record's cover, or during a break with none, the presenter's.</summary>
    public static string? Cover(NowPlayingTrack? track, NowPlayingShow? show)
    {
        if (track is null)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(track.ArtworkUrl))
        {
            return track.ArtworkUrl;
        }

        return track.Kind is NowPlayingTrackKind.Break ? Picture(show) : null;
    }

    /// <summary>The picture beside the host line, unresolved, or null when there is none to draw there.</summary>
    public static string? BesideLine(NowPlayingTrack? track, NowPlayingShow? show)
    {
        if (HostLine.For(track, show) is null || Picture(show) is not { } picture)
        {
            return null;
        }

        return Cover(track, show) == picture ? null : picture;
    }

    private static string? Picture(NowPlayingShow? show) =>
        string.IsNullOrWhiteSpace(show?.HostArtUrl) ? null : show.HostArtUrl.Trim();
}
