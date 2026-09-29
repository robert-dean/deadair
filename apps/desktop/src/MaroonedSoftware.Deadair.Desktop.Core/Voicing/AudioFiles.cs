using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// A recording somebody chose, as the station is told about it.
/// </summary>
/// <remarks>
/// The station decides by content type whether it will take a file, and the open panel offers only
/// the kinds it takes, so the two lists are one list here. A file's own name is the label it arrives
/// with, less its extension and its separators, because that is what somebody would have typed.
/// </remarks>
public static class AudioFiles
{
    /// <summary>What the open panel offers: the formats the station's upload routes accept.</summary>
    public static IReadOnlyList<string> Patterns { get; } = ["*.mp3", "*.wav", "*.ogg", "*.flac", "*.m4a"];

    /// <summary>The content type the station reads a file as, from its extension.</summary>
    public static string ContentType(string fileName)
    {
        ArgumentNullException.ThrowIfNull(fileName);

        return Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".mp3" => "audio/mpeg",
            ".wav" => "audio/wav",
            ".ogg" => "audio/ogg",
            ".flac" => "audio/flac",
            ".m4a" => "audio/mp4",
            _ => "application/octet-stream",
        };
    }

    /// <summary>A file's name as a label: no extension, and underscores and hyphens read as spaces.</summary>
    public static string LabelFor(string fileName)
    {
        ArgumentNullException.ThrowIfNull(fileName);

        var bare = Path.GetFileNameWithoutExtension(fileName).Replace('_', ' ').Replace('-', ' ');
        return string.Join(' ', bare.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>A length as minutes and seconds, or a dash for one nobody has measured.</summary>
    public static string Length(long? milliseconds)
    {
        if (milliseconds is not { } ms || ms < 0)
        {
            return "–";
        }

        var span = TimeSpan.FromMilliseconds(ms);
        return span.TotalHours >= 1
            ? span.ToString(@"h\:mm\:ss", CultureInfo.InvariantCulture)
            : $"{(int)span.TotalMinutes}:{span.Seconds:00}";
    }
}
