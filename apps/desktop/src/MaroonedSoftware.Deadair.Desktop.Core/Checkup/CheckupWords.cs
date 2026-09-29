using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Checkup;

/// <summary>
/// The figures the check-up draws, as a person would say them.
/// </summary>
/// <remarks>
/// <para>
/// Ported from the web console's <c>formatBytes</c>, its loop ages and its feed moments, so the two
/// surfaces reading one station say the same number the same way. The clock is an argument
/// everywhere, for the reason <c>DayGroups</c> gives: a function that read the time itself would
/// pass its tests all day and fail them at midnight.
/// </para>
/// <para>
/// Invariant culture throughout, as the rest of this app's figures are, because a column of numbers
/// in the operator's locale beside timecodes in the invariant one would be two conventions on one
/// page.
/// </para>
/// </remarks>
public static class CheckupWords
{
    private static readonly string[] Units = ["B", "KB", "MB", "GB", "TB"];

    /// <summary>How long between two moments, in the coarsest unit that still says something.</summary>
    /// <remarks>
    /// Rounded rather than exact. Nobody reading a loop's last pass needs the seconds, and a figure
    /// that changes every time the page is opened reads as noise. A moment in the future (a clock on
    /// the station a little ahead of this one) is "just now" rather than a negative age.
    /// </remarks>
    public static string Ago(DateTimeOffset now, DateTimeOffset then)
    {
        var seconds = Math.Max(0, Half((now - then).TotalSeconds));

        return seconds switch
        {
            < 10 => "just now",
            < 60 => $"{seconds:0}s ago",
            < 3600 => $"{Half(seconds / 60):0}m ago",
            < 86_400 => $"{Half(seconds / 3600):0}h ago",
            _ => $"{Half(seconds / 86_400):0}d ago",
        };
    }

    // Half away from zero, as the web console's Math.round does. .NET's default rounds a half to the
    // even neighbour, which put 150 seconds at "2m" here and "3m" there.
    private static double Half(double value) => Math.Round(value, MidpointRounding.AwayFromZero);

    /// <summary>A byte count as <c>du -h</c> and every file manager would say it.</summary>
    /// <remarks>
    /// Binary steps with the short names, because being pedantically correct about KiB would make
    /// this disagree with the terminal it is going to be checked against. One decimal place from a
    /// megabyte up and none below: "1.5 GB" is the number somebody reasons about and "1536.0 KB" is
    /// not. Zero is <c>0 B</c>, since a store with nothing in it is a fact rather than a gap.
    /// </remarks>
    public static string Bytes(long bytes)
    {
        if (bytes <= 0)
        {
            return "0 B";
        }

        var step = Math.Min((int)Math.Floor(Math.Log(bytes) / Math.Log(1024)), Units.Length - 1);
        var value = bytes / Math.Pow(1024, step);
        var figure = step >= 2
            ? value.ToString("0.0", CultureInfo.InvariantCulture)
            : Half(value).ToString("0", CultureInfo.InvariantCulture);

        return $"{figure} {Units[step]}";
    }

    /// <summary>A count with its thousands grouped, since a catalog runs to five figures.</summary>
    public static string Count(long count) => count.ToString("N0", CultureInfo.InvariantCulture);

    /// <summary>A count and its noun, singular for one.</summary>
    public static string Counted(long count, string one, string many) =>
        $"{Count(count)} {(count == 1 ? one : many)}";

    /// <summary>How far through the catalog the station has measured, from 0 to 100.</summary>
    /// <remarks>An empty catalog is nought rather than a division by zero.</remarks>
    public static double Measured(long measured, long total) =>
        total <= 0 ? 0 : Math.Clamp(measured * 100.0 / total, 0, 100);

    /// <summary>When a line in a feed happened.</summary>
    /// <remarks>
    /// The time alone for today, and the day in front of it for anything older: a feed read with
    /// "load more" reaches yesterday within a page or two on a busy station, and 23:40 under 11:27
    /// with nothing between them reads as the same morning. Compared in the reader's own zone, which
    /// is <paramref name="now"/>'s offset.
    /// </remarks>
    public static string Moment(DateTimeOffset now, DateTimeOffset at)
    {
        var local = at.ToOffset(now.Offset);

        return local.Date == now.Date
            ? local.ToString("HH:mm:ss", CultureInfo.InvariantCulture)
            : local.ToString("d MMM HH:mm", CultureInfo.InvariantCulture);
    }
}
