using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Director;

/// <summary>
/// When the running order runs out, if nobody extends it.
/// </summary>
/// <remarks>
/// <para>
/// The single most useful number on the desk, and the station does not send it: it sends durations,
/// and the arithmetic is the client's.
/// </para>
/// <para>
/// It counts only what is still ahead. An item with no duration contributes nothing rather than a
/// guess — a station whose catalog could not say how long a record is should produce a time that is
/// slightly early, not one that is confidently wrong.
/// </para>
/// </remarks>
public static class RunsDry
{
    /// <summary>How much airtime is left, or null when nothing ahead has a length.</summary>
    public static TimeSpan? Remaining(IReadOnlyList<StationOrderItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);

        var total = TimeSpan.Zero;
        var counted = false;

        foreach (var item in items)
        {
            if (item.State is not (StationItemState.Planned or StationItemState.Handed or StationItemState.Airing))
            {
                // Played, skipped, removed, unavailable: none of it is airtime anybody still gets.
                continue;
            }

            if (item.DurationMs is not { } duration || duration <= 0)
            {
                continue;
            }

            total += TimeSpan.FromMilliseconds(duration);
            counted = true;
        }

        return counted ? total : null;
    }

    /// <summary>The wall-clock time it runs out at.</summary>
    public static DateTimeOffset? At(IReadOnlyList<StationOrderItem> items, DateTimeOffset now) =>
        Remaining(items) is { } remaining ? now + remaining : null;

    /// <summary>Whether the order is close enough to empty to be worth saying so.</summary>
    /// <remarks>
    /// Twenty minutes: long enough that an operator has time to do something, short enough that the
    /// warning is not on screen for most of a broadcast and therefore ignored.
    /// </remarks>
    public static bool IsShort(IReadOnlyList<StationOrderItem> items) =>
        Remaining(items) is { } remaining && remaining < TimeSpan.FromMinutes(20);
}
