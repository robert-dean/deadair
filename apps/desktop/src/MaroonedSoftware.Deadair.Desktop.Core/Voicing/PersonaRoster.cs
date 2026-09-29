using System.Net.Http.Headers;
using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// The roster as the Characters tab draws it, and the files a roster travels in.
/// </summary>
/// <remarks>
/// Hosts before callers, whoever is speaking above the station's own host, and the station's own host
/// above the rest; server order otherwise. The station's own host fourteen cards down was the list
/// saying nothing about which card matters, and mixing the two kinds buries both.
/// </remarks>
public static class PersonaRoster
{
    /// <summary>Below this many characters a filter box costs more attention than it saves.</summary>
    public const int FilterFrom = 6;

    /// <summary>What a character is for, with absent read the one way the station reads it.</summary>
    public static PersonaKind KindOf(Persona persona)
    {
        ArgumentNullException.ThrowIfNull(persona);
        return persona.Kind ?? PersonaKind.Host;
    }

    /// <summary>The roster in the order the tab draws it. A stable sort, so the station's order breaks ties.</summary>
    public static IReadOnlyList<Persona> Order(IEnumerable<Persona> personas) =>
        personas
            .OrderBy(persona => KindOf(persona) == PersonaKind.Caller ? 1 : 0)
            .ThenByDescending(persona => persona.Presenting)
            .ThenByDescending(persona => persona.DefaultHost)
            .ToList();

    /// <summary>Whether a character is found by what it is called, what it is, or who it says it is.</summary>
    public static bool Matches(Persona persona, string filter)
    {
        ArgumentNullException.ThrowIfNull(persona);

        var term = (filter ?? string.Empty).Trim();
        return term.Length == 0
            || new[] { persona.Label, persona.Key, persona.Style, persona.DjName ?? string.Empty }
                .Any(field => field.Contains(term, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The one line under a character, which says something only when there is something to say.
    /// </summary>
    /// <remarks>
    /// Each half is printed only when it DEVIATES from a fully equipped character: a line that reads
    /// the same on every card is a line nobody reads on any of them. A caller is not asked about
    /// phrasings, because a caller writes no breaks and saying it has none would report the design as
    /// a gap.
    /// </remarks>
    public static string? Summary(Persona persona)
    {
        ArgumentNullException.ThrowIfNull(persona);

        var parts = new List<string>();
        if (PersonaReadout.TemplateLines(persona.Templates ?? string.Empty).Count == 0 && KindOf(persona) != PersonaKind.Caller)
        {
            parts.Add("no phrasings of its own, so it falls back to the station's when the model declines");
        }

        if ((persona.DictionMarkers?.Count ?? 0) == 0)
        {
            parts.Add("not checked for staying in character");
        }

        if (string.IsNullOrEmpty(persona.Voice))
        {
            parts.Add("speaks in the plugin's default voice");
        }

        return parts.Count == 0 ? null : string.Join(" · ", parts);
    }

    /// <summary>
    /// Which hosts a caller rings in to, named, or null for a caller tied to nobody.
    /// </summary>
    /// <remarks>
    /// Null rather than "rings in to anybody", which is what every caller did before ties existed. An id
    /// the roster does not hold is skipped: the tie went with its host.
    /// </remarks>
    public static string? RingsIn(Persona persona, IReadOnlyList<Persona> roster)
    {
        ArgumentNullException.ThrowIfNull(persona);
        ArgumentNullException.ThrowIfNull(roster);

        var names = (persona.Hosts ?? [])
            .Select(id => roster.FirstOrDefault(row => row.Id == id)?.Label)
            .OfType<string>()
            .ToList();

        return names.Count == 0 ? null : $"Rings in to {string.Join(", ", names)}";
    }

    /// <summary>A character's record on air, or null when it has made no attempts in the window.</summary>
    public static string? Record(ScriptHistorySummaryRow? counts, long hours)
    {
        if (counts is null)
        {
            return null;
        }

        var failed = counts.Failed > 0 ? $" · {counts.Failed} failed" : string.Empty;
        return $"{counts.Written} written · {counts.Declined} declined{failed} in {hours}h";
    }

    /// <summary>
    /// The name to save an export under: the station's own, when it gave one, or the fallback.
    /// </summary>
    /// <remarks>
    /// Only the last segment of whatever the header says, so a name carrying a path cannot choose where
    /// it is written; the save panel is where that is decided.
    /// </remarks>
    public static string FileName(string? contentDisposition, string fallback)
    {
        if (contentDisposition is not null
            && ContentDispositionHeaderValue.TryParse(contentDisposition, out var header)
            && (header.FileNameStar ?? header.FileName)?.Trim('"') is { Length: > 0 } named)
        {
            var leaf = Path.GetFileName(named.Replace('\\', '/'));
            if (leaf.Length > 0)
            {
                return leaf;
            }
        }

        return fallback;
    }

    /// <summary>A persona file as the bytes to save.</summary>
    public static byte[] Serialize(PersonaFile file) => JsonSerializer.SerializeToUtf8Bytes(file, Indented);

    /// <summary>The station's own JSON rules, indented, since somebody may read the file they keep.</summary>
    private static readonly JsonSerializerOptions Indented = new(SdkJson.Options) { WriteIndented = true };

    /// <summary>
    /// A file somebody chose, read as a persona file, or null when it is not JSON of that shape.
    /// </summary>
    /// <remarks>
    /// Read HERE before anything is sent, so the wrong download gets a plain sentence rather than a
    /// refusal from a schema that never had a chance to run. Past that, validating it is the station's.
    /// </remarks>
    public static PersonaFile? Read(byte[] bytes)
    {
        ArgumentNullException.ThrowIfNull(bytes);

        try
        {
            return JsonSerializer.Deserialize<PersonaFile>(bytes, SdkJson.Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>What the import button will do, so it is not the same word as the dialog's title.</summary>
    public static string ImportLabel(PersonaImportPlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);

        var creates = plan.Personas.Count(entry => entry.Outcome == PersonaImportEntryOutcome.Create);
        var updates = plan.Personas.Count - creates;

        return updates == 0 ? $"Import {Characters(creates)}"
            : creates == 0 ? $"Rewrite {Characters(updates)}"
            : $"Import {creates}, rewrite {updates}";
    }

    /// <summary>A character's shelf as one line, and a dash when there is nothing to say.</summary>
    public static string StoryLine(long added, long held) =>
        (added, held) switch
        {
            (0, 0) => "–",
            (_, 0) => $"{added} new",
            (0, _) => $"{held} already here",
            _ => $"{added} new · {held} already here",
        };

    /// <summary>What an import did, in numbers: the plan already said which characters.</summary>
    public static string Imported(PersonaImportResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return $"Imported: {Characters(result.Created)} written, {Count(result.Updated, "sheet")} rewritten, "
            + $"{Count(result.StoriesWritten, "story", "stories")} and {Count(result.DetailsWritten, "detail")} added. Nobody was put on air.";
    }

    private static string Characters(long count) => Count(count, "character");

    private static string Count(long count, string one, string? many = null) =>
        count == 1 ? $"1 {one}" : $"{count} {many ?? one + "s"}";
}
