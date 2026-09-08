namespace MaroonedSoftware.Deadair.Desktop.Core.History;

/// <summary>One day's worth of whatever was passed in, with the heading it goes under.</summary>
public sealed record DayGroup<T>(string Label, IReadOnlyList<T> Items);

/// <summary>
/// Cutting a list into days.
/// </summary>
/// <remarks>
/// <para>
/// History arrives newest first as one flat run, and a flat run of times is unreadable the moment it
/// crosses midnight: 23:40 sits directly under 11:27 and nothing says a day went by.
/// </para>
/// <para>
/// <b>The clock and the zone are arguments.</b> "Today" is a question about the reader's own
/// midnight, not the machine's idea of one, and a function that read <c>DateTimeOffset.Now</c> would
/// be a function whose tests pass in London and fail in Auckland, or pass all day and fail at
/// midnight. Passing them in is what makes the boundary testable at all.
/// </para>
/// </remarks>
public static class DayGroups
{
    public static IReadOnlyList<DayGroup<T>> Of<T>(
        IEnumerable<T> items,
        Func<T, DateTimeOffset> airedAt,
        DateTimeOffset now,
        TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(airedAt);
        ArgumentNullException.ThrowIfNull(zone);

        var today = TimeZoneInfo.ConvertTime(now, zone).Date;
        var groups = new List<DayGroup<T>>();
        var current = new List<T>();
        DateTime? day = null;

        foreach (var item in items)
        {
            var itemDay = TimeZoneInfo.ConvertTime(airedAt(item), zone).Date;

            if (day is { } open && open != itemDay)
            {
                groups.Add(new DayGroup<T>(Label(open, today), current));
                current = [];
            }

            day = itemDay;
            current.Add(item);
        }

        if (day is { } last)
        {
            groups.Add(new DayGroup<T>(Label(last, today), current));
        }

        return groups;
    }

    /// <remarks>
    /// The year appears only when it is not this one. A heading reading "Tuesday 2 September 2026"
    /// on something that aired an hour ago is a heading doing paperwork.
    /// </remarks>
    private static string Label(DateTime day, DateTime today)
    {
        if (day == today)
        {
            return "Today";
        }

        if (day == today.AddDays(-1))
        {
            return "Yesterday";
        }

        return day.Year == today.Year
            ? day.ToString("dddd d MMMM", System.Globalization.CultureInfo.CurrentCulture)
            : day.ToString("d MMMM yyyy", System.Globalization.CultureInfo.CurrentCulture);
    }
}
