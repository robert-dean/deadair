using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>
/// A duration as a listener reads it.
/// </summary>
/// <remarks>
/// Out here rather than inside a view model because two places need the same answer — the bar and
/// the system's own now-playing widget — and because <see cref="Unknown"/> is a decision rather than
/// a placeholder: <see cref="Playhead"/> refuses to guess a position the station could not give, and
/// this is what that refusal looks like in words. Two dashes and a colon, the shape of a timecode,
/// so the column does not resize when a real one arrives.
/// </remarks>
public static class ClockFormat
{
    /// <summary>What a clock says when the station could not say.</summary>
    public const string Unknown = "--:--";

    /// <summary>How far in: <c>3:58</c>, or <c>1:02:10</c> once there is an hour to show.</summary>
    public static string Elapsed(TimeSpan value)
    {
        if (value < TimeSpan.Zero)
        {
            value = TimeSpan.Zero;
        }

        return value.TotalHours >= 1
            ? value.ToString(@"h\:mm\:ss", CultureInfo.InvariantCulture)
            : value.ToString(@"m\:ss", CultureInfo.InvariantCulture);
    }

    /// <summary>How much is left, counting down: <c>-1:46</c>.</summary>
    /// <remarks>
    /// The minus is part of the word rather than something a view prepends, so the two ends of a
    /// playhead cannot be formatted by two different rules.
    /// </remarks>
    public static string Remaining(TimeSpan value) => "-" + Elapsed(value);
}
