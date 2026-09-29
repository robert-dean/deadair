using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>A count of bytes as somebody reads one, the console's <c>formatBytes</c> ported.</summary>
/// <remarks>
/// Binary steps under the familiar names, because that is what the console prints beside the same
/// figures and two readings of one disk that disagree by seven percent would be two facts. Whole
/// numbers below a megabyte and one place above it, where the place is the part that moves.
/// </remarks>
public static class ByteSize
{
    private static readonly string[] Units = ["B", "KB", "MB", "GB", "TB"];

    public static string Format(long bytes, CultureInfo? culture = null)
    {
        var format = culture ?? CultureInfo.CurrentCulture;

        if (bytes <= 0)
        {
            return "0 B";
        }

        var step = Math.Min((int)Math.Floor(Math.Log(bytes) / Math.Log(1024)), Units.Length - 1);
        var value = bytes / Math.Pow(1024, step);

        return string.Create(format, $"{value.ToString(step >= 2 ? "N1" : "N0", format)} {Units[step]}");
    }

    /// <summary>How much of a limit is used, as a whole percentage no greater than a hundred, or null with no limit.</summary>
    /// <remarks>
    /// Capped, because a cache over its limit is one the station is already trimming, and a bar
    /// drawn past its end says nothing more than a full one.
    /// </remarks>
    public static int? Share(long used, long? cap) =>
        cap is > 0 ? (int)Math.Min(100, Math.Round(used / (double)cap.Value * 100, MidpointRounding.AwayFromZero)) : null;
}
