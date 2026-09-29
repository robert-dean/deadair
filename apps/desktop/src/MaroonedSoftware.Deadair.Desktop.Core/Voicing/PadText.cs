using System.Globalization;
using System.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// A sound on the rack as the Soundboard tab draws it.
/// </summary>
/// <remarks>
/// The token is shown exactly as a script has to write it, because it is the string a model is
/// offered and the only spelling the station's answer parser will find; it is never translated or
/// restyled. A new sound's name is its file's name made into that token's shape.
/// </remarks>
public static class PadText
{
    /// <summary>The folder a sound is filed under unless somebody says otherwise, which is also a set.</summary>
    public const string DefaultBoard = "station";

    /// <summary>What a script writes to reach a sound.</summary>
    public static string Token(string name) => $"[sfx:{name}]";

    /// <summary>A file's name as a sound's name: lowercased, every run of anything else one hyphen, none at the ends.</summary>
    public static string NameFor(string fileName)
    {
        ArgumentNullException.ThrowIfNull(fileName);

        return Shape(fileName.Contains('.', StringComparison.Ordinal) ? fileName[..fileName.LastIndexOf('.')] : fileName);
    }

    /// <summary>Anything typed, in a sound name's shape.</summary>
    public static string Shape(string stem)
    {
        ArgumentNullException.ThrowIfNull(stem);

        var name = new StringBuilder(stem.Length);
        var gap = false;
        foreach (var letter in stem.ToLowerInvariant())
        {
            if (letter is (>= 'a' and <= 'z') or (>= '0' and <= '9'))
            {
                if (gap && name.Length > 0)
                {
                    name.Append('-');
                }

                name.Append(letter);
                gap = false;
            }
            else
            {
                gap = true;
            }
        }

        return name.ToString();
    }

    /// <summary>A length in seconds to a tenth, since most of these are shorter than one.</summary>
    public static string Seconds(long? milliseconds) =>
        milliseconds is { } ms ? string.Create(CultureInfo.InvariantCulture, $"{ms / 1000d:0.0}s") : "–";

    /// <summary>
    /// Loudness, or a dash. A sound under about half a second produces no reading at all, which is most
    /// drops, so a dash is ordinary rather than a failure.
    /// </summary>
    public static string Loudness(double? lufs) =>
        lufs is { } value ? string.Create(CultureInfo.InvariantCulture, $"{value:0.0} LUFS") : "–";

    /// <summary>When a presenter last reached for it, or "never" in words, since a dash reads as something unrecorded.</summary>
    public static string LastHit(DateTimeOffset? at, CultureInfo? culture = null) =>
        at is { } when ? when.ToLocalTime().ToString("d MMM, HH:mm", culture ?? CultureInfo.CurrentCulture) : "never";

    /// <summary>What a re-scan did, and the one outcome worth stopping for: a sound nothing can reach.</summary>
    public static string ScanSummary(PadScanResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        var files = result.Scanned == 1 ? "1 file" : $"{result.Scanned} files";
        var said = $"Read {files}: {result.Imported} new, {result.Replaced} replaced, {result.Skipped} passed over.";
        return result.Contested switch
        {
            0 => said,
            1 => $"{said} One could not go on its set, because the set already had a sound under that name: it is in the library and nothing can reach it yet.",
            _ => $"{said} {result.Contested} could not go on their sets, because each set already had a sound under that name: they are in the library and nothing can reach them yet.",
        };
    }

    /// <summary>Who a set reaches, or that nobody is pointed at it.</summary>
    public static string Reaches(PadSet set)
    {
        ArgumentNullException.ThrowIfNull(set);
        return set.Personas.Count == 0 ? "nobody is pointed at it" : string.Join(", ", set.Personas);
    }
}
