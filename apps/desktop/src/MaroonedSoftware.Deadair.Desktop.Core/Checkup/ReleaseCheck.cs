using System.Text;
using System.Text.RegularExpressions;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Checkup;

/// <summary>
/// What the What's new tab says about the station's releases.
/// </summary>
/// <remarks>
/// Ported from the web console's <c>releases.page.tsx</c>, where the same sentences are written.
/// </remarks>
public static partial class ReleaseCheck
{
    /// <summary>How many of the station's own releases are drawn before the rest are asked for.</summary>
    /// <remarks>
    /// Five, because what somebody opens this for is the release they just installed and the few
    /// before it. The changelog holds every release there has been, and drawing all of them puts a
    /// page of notes about problems long fixed between the operator and what they came for.
    /// </remarks>
    public const int Shown = 5;

    /// <summary>How old an answer can be and still count as the one a Check now just got.</summary>
    /// <remarks>
    /// The station answers a click inside a minute of its last question with that question's answer,
    /// and a little more covers a slow request.
    /// </remarks>
    public static readonly TimeSpan FreshAnswer = TimeSpan.FromMinutes(2);

    /// <summary>What a Check now found, in a sentence.</summary>
    /// <remarks>
    /// The tab redraws from the same answer, so a newer release appears in the list either way. This
    /// says what the redraw cannot: that GitHub did not answer, which otherwise looks exactly like
    /// nothing having happened, or that it did and there is nothing newer.
    /// </remarks>
    public static string Outcome(StationReleases releases, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(releases);

        var answered = releases.CheckedAt is { } checkedAt && now - checkedAt < FreshAnswer;
        if (!answered)
        {
            return "GitHub did not answer. The station will try again within the hour.";
        }

        if (releases.Available.Count == 0)
        {
            return releases.Current is { } current
                ? $"Nothing newer than {current} is out."
                : "Nothing newer is out.";
        }

        var newest = releases.Available[0].Version;
        return releases.Available.Count == 1
            ? $"deadair {newest} is out."
            : $"{releases.Available.Count} newer releases are out, the newest {newest}.";
    }

    /// <summary>
    /// A release's Markdown notes as plain text a <c>TextBlock</c> can draw.
    /// </summary>
    /// <remarks>
    /// The notes are a changelog entry: headings, bullets, a link or two and code spans. This app has
    /// no Markdown renderer, and one is a dependency for a tab opened after an upgrade, so the marks
    /// are taken off and the words kept. A heading keeps its line, a bullet becomes a dot, a link
    /// keeps its text, and emphasis and code lose their punctuation. Nothing is dropped that a reader
    /// would miss.
    /// </remarks>
    public static string PlainNotes(string markdown)
    {
        ArgumentNullException.ThrowIfNull(markdown);

        var lines = new List<string>();
        foreach (var raw in markdown.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n'))
        {
            var line = raw.TrimEnd();
            var trimmed = line.TrimStart();
            var indent = line.Length - trimmed.Length;

            if (trimmed.StartsWith('#'))
            {
                line = trimmed.TrimStart('#').Trim();
            }
            else if (trimmed.StartsWith("- ", StringComparison.Ordinal) || trimmed.StartsWith("* ", StringComparison.Ordinal))
            {
                // A nested bullet keeps some of its indent, so a sub-point still reads as one.
                line = new string(' ', Math.Min(indent, 4)) + "• " + trimmed[2..];
            }

            line = Link().Replace(line, "$1");
            line = Emphasis().Replace(line, string.Empty);
            lines.Add(line);
        }

        // Runs of blank lines collapse to one, and none at either end.
        var text = new StringBuilder();
        var blank = false;
        foreach (var line in lines)
        {
            if (line.Length == 0)
            {
                blank = text.Length > 0;
                continue;
            }

            if (blank)
            {
                text.Append('\n');
                blank = false;
            }

            if (text.Length > 0)
            {
                text.Append('\n');
            }

            text.Append(line);
        }

        return text.ToString();
    }

    [GeneratedRegex(@"\[([^\]]+)\]\([^)]*\)")]
    private static partial Regex Link();

    [GeneratedRegex(@"\*\*|__|`")]
    private static partial Regex Emphasis();
}
