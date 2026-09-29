using System.Text.RegularExpressions;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// What a character's dials come to together, and what in its phrasings the station could never use.
/// </summary>
/// <remarks>
/// <para>
/// The dials compose, and no one control can say so: a terse character can be unfiltered, and reading
/// the pair back is the only way an operator sees what they asked for. The sentence describes the
/// SHAPE and never a word count, because the ceilings live in the station's prompt and move with what
/// is measured on air; a number here would be a second claim nothing keeps true.
/// </para>
/// <para>
/// The phrasing checks are advisory and never block a save. The vocabulary is a copy of the station's,
/// and a desk that refused a save over its own copy would stop working the day the station learns a
/// new placeholder. What they replace is watching a character for an evening and wondering why one of
/// its lines never comes up.
/// </para>
/// </remarks>
public static partial class PersonaReadout
{
    /// <summary>The placeholders the station can fill, as the web console's copy has them.</summary>
    public static IReadOnlySet<string> Vocabulary { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "previous.title", "previous.name", "previous.artist", "previous.artist.name",
        "next.title", "next.name", "next.artist", "next.artist.name",
        "station.name", "dj.name", "clock.rough",
        "news.headlines", "news.topic", "weather.report", "weather.place",
        "almanac.report", "almanac.date", "greeting",
        "outgoing.name", "outgoing.show", "show.name",
    };

    /// <summary>The dials, read back as one sentence.</summary>
    public static string Describe(string brevity, string latitude, string storytelling, string chattiness, string trivia)
    {
        var length = brevity switch
        {
            "one-line" => "one line",
            "short" => "a sentence or two",
            _ when latitude.Length == 0 && trivia.Length == 0 => "the station's usual length",
            _ => "as long as it takes",
        };

        var manner = latitude switch
        {
            "unleashed" => "Says what it likes, however it likes",
            "loose" => "Follows a thought where it goes",
            _ => "Makes one point",
        };

        // Material rather than manner, so a sentence of its own rather than another clause.
        var lore = trivia == "keen" ? " It builds each link out of the story behind the record, from what the station knows about it." : string.Empty;

        var stories = storytelling switch
        {
            "never" => " It keeps its stories to itself in a link.",
            "often" => " It works one of its own stories into most breaks.",
            _ => " It reaches for one of its own stories when the station knows nothing about the records.",
        };

        // How many breaks rather than how one sounds, so it comes last.
        var often = chattiness switch
        {
            "relentless" => " It talks twice as often as the station would on its own.",
            "chatty" => " It talks a little more often than the station would on its own.",
            "sparing" => " It talks a little less often than the station would on its own.",
            "reserved" => " It talks half as often as the station would on its own.",
            _ => string.Empty,
        };

        return $"{manner}, in {length}. The station's content rules and its refusals are unchanged either way.{lore}{stories}{often}";
    }

    /// <summary>The phrasings a line at a time, skipping blank lines and the ones switched off with <c>#</c>.</summary>
    public static IReadOnlyList<string> TemplateLines(string raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        return raw.Split('\n')
            .Select(line => line.Trim())
            .Where(line => line.Length > 0 && !line.StartsWith('#'))
            .ToList();
    }

    /// <summary>Why the station would never pick this phrasing, or null when it could.</summary>
    public static string? FaultIn(string template)
    {
        ArgumentNullException.ThrowIfNull(template);

        var unknown = Placeholder().Matches(template)
            .Select(match => match.Groups[1].Value)
            .Where(name => !Vocabulary.Contains(name))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (unknown.Count > 0)
        {
            return $"names {string.Join(", ", unknown.Select(name => $"{{{{{name}}}}}"))}, which the station cannot fill in";
        }

        if (StrayBracket().IsMatch(OptionalPart().Replace(template, string.Empty)))
        {
            return "has a single bracket, which is read out rather than treated as an optional part";
        }

        return template.Contains("{{", StringComparison.Ordinal) ? null : "names no record, so it would say the same thing after every one";
    }

    /// <summary>Every phrasing the station could never use, each with the reason.</summary>
    public static IReadOnlyList<(string Line, string Fault)> Faults(string raw) =>
        TemplateLines(raw)
            .Select(line => (Line: line, Fault: FaultIn(line)))
            .Where(entry => entry.Fault is not null)
            .Select(entry => (entry.Line, entry.Fault!))
            .ToList();

    [GeneratedRegex(@"\{\{\s*([^}]*?)\s*\}\}")]
    private static partial Regex Placeholder();

    [GeneratedRegex(@"\[\[.*?\]\]", RegexOptions.Singleline)]
    private static partial Regex OptionalPart();

    [GeneratedRegex(@"[\[\]]")]
    private static partial Regex StrayBracket();
}
