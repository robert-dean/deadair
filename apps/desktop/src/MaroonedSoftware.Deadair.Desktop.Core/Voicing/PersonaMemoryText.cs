using System.Globalization;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// The words for what a character has accumulated, and for what undoing it would cost.
/// </summary>
/// <remarks>
/// A rollback has two costs an operator would not expect, and both are said before the button that
/// does it: a proposal they turned down becomes proposable again, and one they ACCEPTED is still the
/// station's row and still goes. Everything else it removes is only what the station wrote itself.
/// </remarks>
public static class PersonaMemoryText
{
    /// <summary>What a rollback would undo, one sentence a line, most important first.</summary>
    public static IReadOnlyList<string> Summary(PersonaMemoryChange change)
    {
        ArgumentNullException.ThrowIfNull(change);

        if (change.Tellings + change.Notes + change.Stories + change.Details == 0)
        {
            return ["There is nothing after that moment to undo."];
        }

        var counts = new[]
            {
                Count(change.Tellings, "telling forgotten", "tellings forgotten"),
                Count(change.Notes, "note", "notes"),
                Count(change.Stories, "story", "stories"),
                Count(change.Details, "detail", "details"),
            }
            .OfType<string>();

        var lines = new List<string>
        {
            string.Join(" · ", counts),
            "Only what the station wrote itself. Anything you typed stays exactly where it is.",
        };

        if (change.Rejected > 0)
        {
            lines.Add(change.Rejected == 1
                ? "One of them was a proposal you turned down, so the nightly pass may offer it again."
                : $"{change.Rejected} of them were proposals you turned down, so the nightly pass may offer them again.");
        }

        if (change.Touched > 0)
        {
            lines.Add(change.Touched == 1
                ? "One of them you had accepted or edited, and it still goes."
                : $"{change.Touched} of them you had accepted or edited, and they still go.");
        }

        return lines;
    }

    private static string? Count(long count, string one, string many) =>
        count switch
        {
            0 => null,
            1 => $"1 {one}",
            _ => $"{count} {many}",
        };

    /// <summary>A moment on the timeline in this Mac's own words, or the text as sent when it is not a time.</summary>
    public static string Moment(string iso, CultureInfo? culture = null)
    {
        ArgumentNullException.ThrowIfNull(iso);

        return DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)
            ? at.ToLocalTime().ToString("d MMM yyyy, HH:mm", culture ?? CultureInfo.CurrentCulture)
            : iso;
    }

    /// <summary>How often a story has been told, which is the one fact about it no sheet can say.</summary>
    public static string Told(long times) => times switch
    {
        0 => "never told",
        1 => "told once",
        _ => $"told {times} times",
    };

    /// <summary>
    /// Where the next part of a story in parts goes: ten past the last, so one can later be written
    /// between two without renumbering.
    /// </summary>
    public static long NextOrdinal(IEnumerable<PersonaStoryBeat> beats)
    {
        ArgumentNullException.ThrowIfNull(beats);
        return (beats.Where(beat => beat.State != PersonaStoryBeatState.Rejected).Select(beat => (long?)beat.Ordinal).Max() ?? 0) + 10;
    }

    /// <summary>
    /// Who the presenter name reaches, as one line, naming them: "one host" leaves the operator to work
    /// out which.
    /// </summary>
    public static string PresenterName(string name, IReadOnlyList<string> unnamedHosts)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(unnamedHosts);

        var who = string.Join(", ", unnamedHosts);
        var many = unnamedHosts.Count > 1;

        if (name.Trim().Length > 0)
        {
            return unnamedHosts.Count == 0
                ? $"Every host here has a name of its own, so {name} is heard only while nobody is on air."
                : $"{who} {(many ? "go" : "goes")} by {name} on air, having no name of {(many ? "their" : "its")} own.";
        }

        return unnamedHosts.Count == 0
            ? "Every host here has a name of its own."
            : $"{who} {(many ? "have" : "has")} no name on air, so the phrasings that ask for one are skipped. Set one here, or give "
                + $"{(many ? "them" : "it")} one in {(many ? "their" : "its")} own sheet.";
    }

    /// <summary>How long a presenter leaves a story in parts before returning to it, as a sentence.</summary>
    public static string StoryWait(long minutes)
    {
        var duration = minutes switch
        {
            60 => "an hour",
            _ when minutes % 60 == 0 => $"{minutes / 60} hours",
            1 => "1 minute",
            _ => $"{minutes} minutes",
        };

        return $"A presenter leaves {duration} before returning to a story in parts or a running joke.";
    }
}
