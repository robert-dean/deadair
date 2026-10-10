using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>
/// Where the record is up to, between readings.
/// </summary>
/// <remarks>
/// <para>
/// The station is polled every few seconds and a playhead moves every frame, so the position shown
/// is projected locally from the last reading and re-anchored whenever a new one arrives.
/// </para>
/// <para>
/// <b>It refuses to answer when the station could not say.</b> <c>remainingMs</c> is absent when the
/// decoder does not know, and the tempting fallback — subtracting <c>startedAt</c> from the clock —
/// is wrong in a way that looks right: it measures how long ago the station STARTED the record,
/// which leads what a listener is hearing by the encoder and buffer, and drifts further the worse
/// somebody's connection is. A progress bar that is confidently wrong is worse than one that is
/// absent, so this returns null and the view draws nothing.
/// </para>
/// </remarks>
public static class Playhead
{
    /// <summary>
    /// How far into the record the listener is, or null when it cannot be said.
    /// </summary>
    /// <param name="track">The track from the last reading.</param>
    /// <param name="readAt">When the listener hears the moment that reading describes: when it arrived,
    /// moved on by however far behind the station the audio is.</param>
    /// <param name="now">The current time.</param>
    public static TimeSpan? Position(NowPlayingTrack? track, DateTimeOffset? readAt, DateTimeOffset now)
    {
        if (track?.DurationMs is not { } duration || duration <= 0)
        {
            return null;
        }

        if (track.RemainingMs is not { } remaining || readAt is not { } anchor)
        {
            return null;
        }

        var elapsedAtRead = TimeSpan.FromMilliseconds(duration - remaining);
        // Not clamped at zero, and it was. The listener's anchor is when they HEAR the moment the
        // reading describes (`NowPlayingHold.Heard`), which is a lead later than the poll answered,
        // so for that long `now` is before it and the listener is behind the station's figure.
        // Clamping that gap to nothing held the bar still for the lead after every reading, which on
        // a three-second poll and a five-second lead is a bar that never moves.
        var since = now - anchor;
        var position = elapsedAtRead + since;
        var length = TimeSpan.FromMilliseconds(duration);

        if (position < TimeSpan.Zero)
        {
            return TimeSpan.Zero;
        }

        // Clamped rather than allowed to run past the end: the next reading is at most a few seconds
        // away, and a bar that overshoots to 103% is a more obvious lie than one that sits at the end.
        return position > length ? length : position;
    }

    /// <summary>The record's length, when the station gave one.</summary>
    public static TimeSpan? Duration(NowPlayingTrack? track) =>
        track?.DurationMs is { } ms && ms > 0 ? TimeSpan.FromMilliseconds(ms) : null;
}
