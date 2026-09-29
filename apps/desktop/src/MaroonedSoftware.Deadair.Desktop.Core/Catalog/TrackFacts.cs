using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>What one copy of a record is doing, as a lamp, a word and a sentence.</summary>
public sealed record CopyStatus(StatusTone Tone, string Label, string Detail);

/// <summary>
/// How a record's copies, its measurement and its airings read on its own page.
/// </summary>
/// <remarks>
/// The copy's states are asked in the web console's order, and the order is the rule: a copy that
/// was benched may still carry the error that benched it, and one the provider will not serve may
/// still have bytes from before it stopped, so the question that settles what the copy IS comes
/// first.
/// </remarks>
public static class TrackFacts
{
    /// <summary>A moment to the minute in this Mac's own convention, or a dash for never.</summary>
    /// <remarks>
    /// The date and the time are formatted apart because "t" is only the short-time pattern when it
    /// stands alone; inside a custom format it is the first letter of AM or PM.
    /// </remarks>
    public static string When(DateTimeOffset? at, CultureInfo? culture = null)
    {
        if (at is not { } moment)
        {
            return "—";
        }

        var format = culture ?? CultureInfo.CurrentCulture;
        var local = moment.ToLocalTime();
        return $"{local.ToString("d MMM yyyy", format)}, {local.ToString("t", format)}";
    }

    /// <summary>A size the way somebody reads one, or a dash for nothing held.</summary>
    public static string Bytes(long? bytes, CultureInfo? culture = null)
    {
        if (bytes is not { } size || size < 0)
        {
            return "—";
        }

        var format = culture ?? CultureInfo.CurrentCulture;
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double value = size;
        var unit = 0;
        while (value >= 1000 && unit < units.Length - 1)
        {
            value /= 1000;
            unit++;
        }

        return unit == 0
            ? string.Create(format, $"{size} B")
            : string.Create(format, $"{value:0.#} {units[unit]}");
    }

    public static CopyStatus Status(TrackBinding binding, CultureInfo? culture = null)
    {
        ArgumentNullException.ThrowIfNull(binding);

        if (binding.MissingAt is { } missing)
        {
            return new(StatusTone.Off, "Benched", $"The station gave up on this copy {When(missing, culture)}. The next sync that still sees it puts it back.");
        }

        if (!binding.Playable)
        {
            return new(StatusTone.Off, "Not offered", "The provider knows this record but will not serve this copy here.");
        }

        if (binding.LastError is { } error && binding.ByteSize is null)
        {
            return new(
                StatusTone.Fault,
                string.Create(CultureInfo.InvariantCulture, $"Failing ({binding.Attempts})"),
                $"{error}. Next attempt {When(binding.NextAttemptAt, culture)}.");
        }

        if (binding.ByteSize is not null)
        {
            return new(StatusTone.Ok, "Held", $"Fetched {When(binding.FetchedAt, culture)}.");
        }

        if (binding.LastServedAt is { } served)
        {
            return new(
                StatusTone.Standby,
                "Dropped",
                $"Played {When(served, culture)} and since dropped to stay under the cache limit. The station fetches it again when it comes round.");
        }

        return new(StatusTone.Standby, "Not fetched", "Nothing has needed this copy yet. The station fetches it before its first slot.");
    }

    /// <summary>A copy's format and bitrate, or its format alone.</summary>
    public static string Format(TrackBinding binding)
    {
        ArgumentNullException.ThrowIfNull(binding);

        var format = binding.Format ?? "—";
        return binding.Bitrate is { } bitrate
            ? string.Create(CultureInfo.InvariantCulture, $"{format} · {Math.Round(bitrate / 1000.0)}k")
            : format;
    }

    /// <summary>
    /// Whether a measurement is one to trust. <c>Complete</c> decides it rather than the date, because
    /// a measurement of a truncated download carries a date and is wrong.
    /// </summary>
    public static (StatusTone Tone, string Label) Measurement(TrackAnalysis analysis)
    {
        ArgumentNullException.ThrowIfNull(analysis);

        return analysis.FailedAt is not null
            ? (StatusTone.Fault, "Failed")
            : analysis.Complete
                ? (StatusTone.Ok, "Measured")
                : (StatusTone.Off, "Incomplete");
    }

    /// <summary>What a record's own line under its title says: who, on what, when, and how long.</summary>
    public static string Credit(string artists, string? album, long? year, long? durationMs)
    {
        var parts = new List<string> { artists };
        if (!string.IsNullOrEmpty(album))
        {
            parts.Add(album);
        }

        if (year is { } y)
        {
            parts.Add(y.ToString(CultureInfo.InvariantCulture));
        }

        if (durationMs is > 0)
        {
            parts.Add(CatalogPaging.Length(durationMs));
        }

        return string.Join(" · ", parts);
    }
}
