using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>Where a paged list is, said the way somebody reads it.</summary>
public static class CatalogPaging
{
    /// <summary>"51–100 of 766", or nothing for an empty list, whose emptiness is said elsewhere.</summary>
    public static string Summary(long page, long pageSize, long total)
    {
        if (total <= 0 || pageSize <= 0)
        {
            return string.Empty;
        }

        var first = (page * pageSize) + 1;
        var last = Math.Min((page + 1) * pageSize, total);
        return string.Create(CultureInfo.CurrentCulture, $"{first:N0}–{last:N0} of {total:N0}");
    }

    public static bool HasNext(long page, long pageSize, long total) => (page + 1) * pageSize < total;

    /// <summary>A length in minutes and seconds, or a placeholder for a record nobody has measured.</summary>
    /// <remarks>A zero is drawn as unknown, because no record is zero seconds long and one that says so is a record nobody measured.</remarks>
    public static string Length(long? milliseconds) => milliseconds is { } ms && ms > 0
        ? TimeSpan.FromMilliseconds(ms).ToString(ms >= 3_600_000 ? @"h\:mm\:ss" : @"m\:ss", CultureInfo.InvariantCulture)
        : "--:--";
}
