using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Programme;

/// <summary>
/// Reading and writing the station's clock, which this app never works out for itself.
/// </summary>
/// <remarks>
/// <para>
/// The schedule stores a time of day as minutes past midnight, which is right for a resolver and
/// wrong for a person, and it sends a moment as <c>YYYY-MM-DD HH:mm:ss</c> on the station's own
/// clock with no zone. Both conversions live here, because two places doing either differently is
/// how a schedule comes to show one time and fire at another. The rules are the web console's
/// <c>schedule.day.ts</c>, ported.
/// </para>
/// <para>
/// A reading is never turned into an instant in the Mac's zone. The station's timezone is not this
/// machine's business, and the only arithmetic done on a reading is subtracting another reading taken
/// in the same answer.
/// </para>
/// </remarks>
public static class StationTime
{
    /// <summary>Minutes in a day, which is the space a slot's times live in.</summary>
    public const int MinutesInDay = 24 * 60;

    private static readonly string[] Weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    /// <summary>Sunday first, as the station numbers them.</summary>
    public static IReadOnlyList<string> WeekdayNames => Weekdays;

    /// <summary><c>360</c> as <c>06:00</c>. Always two digits, so a column of them lines up in mono.</summary>
    public static string Clock(long minutes)
    {
        var wrapped = ((minutes % MinutesInDay) + MinutesInDay) % MinutesInDay;
        return string.Create(CultureInfo.InvariantCulture, $"{wrapped / 60:00}:{wrapped % 60:00}");
    }

    /// <summary>
    /// A block's END as a clock, where midnight is the far end of the day.
    /// </summary>
    /// <remarks>
    /// The station stores an end of midnight as 0 (and once stored it as 1440). Drawn as <c>00:00</c>
    /// it makes a late show look as though it ends before it starts, so both read <c>24:00</c>.
    /// </remarks>
    public static string EndClock(long minutes) => minutes is 0 or MinutesInDay ? "24:00" : Clock(minutes);

    /// <summary>
    /// <c>06:00</c> as <c>360</c>, or null for anything that is not a time.
    /// </summary>
    /// <remarks>
    /// Refused rather than coerced: a slot at a time nobody chose is a changeover at an hour an
    /// operator cannot account for. <paramref name="end"/> also takes <c>24:00</c>, which is midnight
    /// at the far end and is sent as 0, because the station's range stops at 1439 and reads an end
    /// at or before the start as running past midnight.
    /// </remarks>
    public static int? ParseClock(string? text, bool end = false)
    {
        var trimmed = (text ?? string.Empty).Trim();
        var colon = trimmed.IndexOf(':', StringComparison.Ordinal);
        if (colon is < 1 or > 2 || trimmed.Length != colon + 3)
        {
            return null;
        }

        if (!int.TryParse(trimmed.AsSpan(0, colon), NumberStyles.None, CultureInfo.InvariantCulture, out var hour)
            || !int.TryParse(trimmed.AsSpan(colon + 1), NumberStyles.None, CultureInfo.InvariantCulture, out var minute))
        {
            return null;
        }

        if (end && hour == 24 && minute == 0)
        {
            return 0;
        }

        return hour > 23 || minute > 59 ? null : (hour * 60) + minute;
    }

    /// <summary>How many minutes apart two readings of the station's clock are.</summary>
    /// <remarks>
    /// Clock arithmetic rather than elapsed time: on the night the clocks go back a block ending at two
    /// reads an hour shorter than it will run. That is the arithmetic the timetable is drawn with, and
    /// the right one for words whose subject is what the station's clock says.
    /// </remarks>
    public static int MinutesBetween(string from, string to) =>
        Read(from) is { } start && Read(to) is { } finish ? (int)Math.Round((finish - start).TotalMinutes) : 0;

    /// <summary>A reading as a civil date and time, or null for one that is not one.</summary>
    public static DateTime? Read(string? stamp) =>
        DateTime.TryParseExact(stamp, "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var value)
            ? value
            : null;

    /// <summary>A reading's weekday and times: <c>Wed 06:00–10:00</c>.</summary>
    /// <remarks>
    /// The date is dropped: three of these sit side by side, and the useful difference between them is
    /// the hour. A block that started yesterday keeps its own start, which is what "since 22:00" means.
    /// </remarks>
    public static string When(string start, string end)
    {
        var from = Read(start);
        var until = Read(end);
        if (from is null || until is null)
        {
            return string.Empty;
        }

        // A block ends at midnight exclusive, which the station writes as the next day's 00:00.
        var closing = until.Value.TimeOfDay == TimeSpan.Zero && until.Value.Date > from.Value.Date ? "24:00" : Clock((int)until.Value.TimeOfDay.TotalMinutes);
        return $"{Weekdays[(int)from.Value.DayOfWeek]} {Clock((int)from.Value.TimeOfDay.TotalMinutes)}–{closing}";
    }

    /// <summary>
    /// A number of minutes as somebody would say it: <c>12 min</c>, <c>2 h 5 min</c>, <c>3 days</c>.
    /// </summary>
    /// <remarks>
    /// The unit coarsens as the number grows, because a block that runs once a week genuinely is six
    /// days off and "161 h" is a true answer nobody can read. Never seconds: the reading moves when the
    /// page is fetched, and a figure that pretended to count would be a second clock.
    /// </remarks>
    public static string Span(int minutes)
    {
        if (minutes <= 0)
        {
            return "ending";
        }

        if (minutes < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{minutes} min");
        }

        if (minutes < MinutesInDay)
        {
            var hours = minutes / 60;
            var rest = minutes % 60;
            return rest == 0
                ? string.Create(CultureInfo.InvariantCulture, $"{hours} h")
                : string.Create(CultureInfo.InvariantCulture, $"{hours} h {rest} min");
        }

        var days = (int)Math.Round(minutes / (double)MinutesInDay);
        return days == 1 ? "a day" : string.Create(CultureInfo.InvariantCulture, $"{days} days");
    }
}
