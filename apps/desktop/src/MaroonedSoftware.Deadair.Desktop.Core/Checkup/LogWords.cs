using System.Globalization;
using System.Text.RegularExpressions;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Checkup;

/// <summary>
/// What the Logs tab says about the logs the station keeps on disk.
/// </summary>
/// <remarks>
/// Ported from the web console's <c>logs.page.tsx</c>.
/// </remarks>
public static partial class LogWords
{
    /// <summary>A source as the picker offers it: its size when there is a file, and that there is not when there is none.</summary>
    /// <remarks>
    /// Absent is a state rather than a fault, so an absent source is still offered: a station whose
    /// stream has never run has no audio-chain log, and hiding it would answer "where is that log?"
    /// by pretending nobody asked.
    /// </remarks>
    public static string Offered(LogSource source)
    {
        ArgumentNullException.ThrowIfNull(source);

        return source.Present
            ? $"{source.Label} ({CheckupWords.Bytes(source.Bytes)})"
            : $"{source.Label}, nothing written yet";
    }

    /// <summary>What would fill an empty log, per source.</summary>
    /// <remarks>
    /// The two stream answers differ: one process has never run, the other exists only on an install
    /// that fetches its records that way. Anything else is the station's own, which writes from its
    /// first line.
    /// </remarks>
    public static string NothingWritten(string sourceId) => "Nothing has been written to this log. " + sourceId switch
    {
        "liquidsoap" => "The audio chain writes it once it starts, and it is not visible to the console outside the station container.",
        "shim" => "The track shim writes it, and only an install that fetches records through one has it at all.",
        _ => "The station writes it from its first line, so an empty one means this process has only just started.",
    };

    /// <summary>When a line was written, as the time alone in the reader's zone, or null when the line did not say.</summary>
    /// <remarks>
    /// Liquidsoap's and the shim's lines carry no stamp this can parse, and those are drawn as the
    /// file wrote them rather than with a blank column in front.
    /// </remarks>
    public static string? Stamp(string? ts, TimeSpan offset)
    {
        if (ts is null || !DateTimeOffset.TryParse(ts, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at))
        {
            return null;
        }

        return at.ToOffset(offset).ToString("HH:mm:ss", CultureInfo.InvariantCulture);
    }

    /// <summary>The name a downloaded log is offered under.</summary>
    /// <remarks>
    /// The station names the file in <c>Content-Disposition</c> and that name wins, since it is the one
    /// a bug report will quote. Without one, the source's id makes a name that still says which log it
    /// was. A path in the header is cut to its last part: a save panel offered a directory as a name
    /// would be the station choosing where on this machine the file goes.
    /// </remarks>
    public static string DownloadName(string? contentDisposition, string sourceId)
    {
        if (contentDisposition is not null && FileName().Match(contentDisposition) is { Success: true } match)
        {
            var name = Path.GetFileName(match.Groups["name"].Value.Replace('\\', '/').Trim());
            if (name.Length > 0)
            {
                return name;
            }
        }

        return $"deadair-{sourceId}.log";
    }

    [GeneratedRegex("filename\\*?=(?:UTF-8'')?\"?(?<name>[^\";]+)\"?", RegexOptions.IgnoreCase)]
    private static partial Regex FileName();
}
