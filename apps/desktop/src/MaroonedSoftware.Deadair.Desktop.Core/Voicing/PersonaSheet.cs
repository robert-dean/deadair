using System.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// One character as the editor holds it: every list is one string, one entry per line.
/// </summary>
/// <remarks>
/// <para>
/// One entry per line is the web console's decision and it is kept: a quirk and a line of diction are
/// sentences, and a box that took words would invite an operator to type them as words. The
/// conversion to the arrays the station takes happens here rather than in the view model, because "one
/// per line" is a decision about a text box and is testable without one.
/// </para>
/// <para>
/// Each dial is held as the station's own word, with the empty string for the rung that is not there.
/// </para>
/// </remarks>
public sealed record PersonaSheet
{
    public string Key { get; init; } = string.Empty;

    public string Label { get; init; } = string.Empty;

    public string Style { get; init; } = string.Empty;

    public string DjName { get; init; } = string.Empty;

    public string Voice { get; init; } = string.Empty;

    public string Soundboard { get; init; } = string.Empty;

    public string Background { get; init; } = string.Empty;

    public string Brevity { get; init; } = string.Empty;

    public string Latitude { get; init; } = string.Empty;

    public string Chattiness { get; init; } = string.Empty;

    public string Storytelling { get; init; } = string.Empty;

    public string Growth { get; init; } = string.Empty;

    public string Trivia { get; init; } = string.Empty;

    public string Templates { get; init; } = string.Empty;

    public string Diction { get; init; } = string.Empty;

    public string DictionMarkers { get; init; } = string.Empty;

    public string Quirks { get; init; } = string.Empty;

    public string Preoccupations { get; init; } = string.Empty;

    public string Catchphrases { get; init; } = string.Empty;

    public string Avoid { get; init; } = string.Empty;

    public string ExclusiveSubjects { get; init; } = string.Empty;

    public string Samples { get; init; } = string.Empty;

    /// <summary>The hosts a caller rings in to, by id. Picked rather than typed, so held as the list it is sent as.</summary>
    public IReadOnlyList<string> Hosts { get; init; } = [];

    /// <summary>A saved character, as the form's values.</summary>
    public static PersonaSheet From(Persona persona)
    {
        ArgumentNullException.ThrowIfNull(persona);

        return new PersonaSheet
        {
            Key = persona.Key,
            Label = persona.Label,
            Style = persona.Style,
            DjName = persona.DjName ?? string.Empty,
            Voice = persona.Voice ?? string.Empty,
            Soundboard = persona.Soundboard ?? string.Empty,
            Background = persona.Background ?? string.Empty,
            Brevity = Wire.Name(persona.Brevity),
            Latitude = Wire.Name(persona.Latitude),
            Chattiness = OrdinaryIsAbsent(Wire.Name(persona.Chattiness)),
            Storytelling = OccasionallyIsAbsent(Wire.Name(persona.Storytelling)),
            Growth = ProposesIsAbsent(Wire.Name(persona.Growth)),
            Trivia = Wire.Name(persona.Trivia),
            Templates = persona.Templates ?? string.Empty,
            Diction = Lines(persona.Diction),
            DictionMarkers = Lines(persona.DictionMarkers),
            Quirks = Lines(persona.Quirks),
            Preoccupations = Lines(persona.Preoccupations),
            Catchphrases = Lines(persona.Catchphrases),
            Avoid = Lines(persona.Avoid),
            ExclusiveSubjects = Lines(persona.ExclusiveSubjects),
            Samples = Lines(persona.Samples),
            Hosts = persona.Hosts ?? [],
        };
    }

    /// <summary>
    /// A generated draft, as the form's values.
    /// </summary>
    /// <remarks>
    /// A draft has no growth and no ties, by design: a model writing a character must not be able to
    /// grant it autonomy, and the ties are this station's own ids, which nothing a model says could know.
    /// </remarks>
    public static PersonaSheet From(PersonaDraftView draft)
    {
        ArgumentNullException.ThrowIfNull(draft);

        return new PersonaSheet
        {
            Key = draft.Key,
            Label = draft.Label,
            Style = draft.Style,
            DjName = draft.DjName ?? string.Empty,
            Voice = draft.Voice ?? string.Empty,
            Soundboard = draft.Soundboard ?? string.Empty,
            Background = draft.Background ?? string.Empty,
            Brevity = Wire.Name(draft.Brevity),
            Latitude = Wire.Name(draft.Latitude),
            Chattiness = OrdinaryIsAbsent(Wire.Name(draft.Chattiness)),
            Storytelling = OccasionallyIsAbsent(Wire.Name(draft.Storytelling)),
            Trivia = Wire.Name(draft.Trivia),
            Templates = draft.Templates ?? string.Empty,
            Diction = Lines(draft.Diction),
            DictionMarkers = Lines(draft.DictionMarkers),
            Quirks = Lines(draft.Quirks),
            Preoccupations = Lines(draft.Preoccupations),
            Catchphrases = Lines(draft.Catchphrases),
            Avoid = Lines(draft.Avoid),
            ExclusiveSubjects = Lines(draft.ExclusiveSubjects),
            Samples = Lines(draft.Samples),
        };
    }

    /// <summary>
    /// The form as the station takes it.
    /// </summary>
    /// <remarks>
    /// An empty field is left OUT rather than sent as an empty string, which is what makes clearing the
    /// on-air name mean "use the station's" rather than "the presenter is called nothing". The middle
    /// rung of every dial is absent too: a stored value meaning "unchanged" says what a missing one
    /// already does.
    /// </remarks>
    public PersonaInput ToInput(PersonaKind kind) => new()
    {
        Key = Key.Trim(),
        Kind = kind,
        Label = Label.Trim(),
        Style = Style.Trim(),
        DjName = Text(DjName),
        Voice = Text(Voice),
        Soundboard = Text(Soundboard),
        Background = Text(Background),
        Brevity = Wire.Parse<PersonaBrevity>(Brevity),
        Latitude = Wire.Parse<PersonaLatitude>(Latitude),
        Chattiness = Wire.Parse<PersonaChattiness>(OrdinaryIsAbsent(Chattiness)),
        Storytelling = Wire.Parse<PersonaStorytelling>(OccasionallyIsAbsent(Storytelling)),
        Growth = Wire.Parse<PersonaGrowth>(ProposesIsAbsent(Growth)),
        Trivia = Wire.Parse<PersonaTrivia>(Trivia),

        // Not trimmed line by line: the station parses the phrasings the way it parses its own
        // setting, and a blank line between two of them is somebody spacing their list.
        Templates = Text(Templates),
        Diction = ListOf(Diction),
        DictionMarkers = ListOf(DictionMarkers),
        Quirks = ListOf(Quirks),
        Preoccupations = ListOf(Preoccupations),
        Catchphrases = ListOf(Catchphrases),
        Avoid = ListOf(Avoid),
        ExclusiveSubjects = ListOf(ExclusiveSubjects),
        Samples = ListOf(Samples),

        // Only a caller rings in, and an absent list unties one.
        Hosts = kind == PersonaKind.Caller && Hosts.Count > 0 ? [.. Hosts] : null,
    };

    /// <summary>
    /// Whether two sheets say the same thing. A record compares its list by reference, so the ties are
    /// compared by what they hold.
    /// </summary>
    public bool SameAs(PersonaSheet other)
    {
        ArgumentNullException.ThrowIfNull(other);

        return this with { Hosts = Array.Empty<string>() } == other with { Hosts = Array.Empty<string>() }
            && Hosts.Order(StringComparer.Ordinal).SequenceEqual(other.Hosts.Order(StringComparer.Ordinal));
    }

    /// <summary>The first thing stopping this being saved, in the order the fields are drawn, or null.</summary>
    public string? Problem() =>
        Label.Trim().Length == 0 ? "A persona needs a name."
        : Key.Trim().Length == 0 ? "A persona needs a key."
        : Style.Trim().Length == 0 ? "Say who this character is."
        : null;

    /// <summary>
    /// A name as the key it would be given.
    /// </summary>
    /// <remarks>
    /// Lowercased, and every run of anything that is not a letter or a digit becomes one hyphen, with
    /// none at either end. That DROPS accents rather than folding them, which is right for a slug
    /// somebody has to type back, and it is only ever a suggestion for a NEW character: the key is
    /// what the station's script history stamps, so moving it under a rename would detach a character
    /// from everything it has said.
    /// </remarks>
    public static string KeyFor(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var key = new StringBuilder(name.Length);
        var gap = false;
        foreach (var letter in name.ToLowerInvariant())
        {
            if (letter is (>= 'a' and <= 'z') or (>= '0' and <= '9'))
            {
                if (gap && key.Length > 0)
                {
                    key.Append('-');
                }

                key.Append(letter);
                gap = false;
            }
            else
            {
                gap = true;
            }
        }

        return key.ToString();
    }

    /// <summary>A list as one entry per line.</summary>
    public static string Lines(IEnumerable<string>? values) => values is null ? string.Empty : string.Join('\n', values);

    /// <summary>One entry per line as a list, or null when there are none, so the field is left out.</summary>
    public static List<string>? ListOf(string raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        var lines = raw.Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0).ToList();
        return lines.Count == 0 ? null : lines;
    }

    /// <summary>
    /// Markers the character's own sample lines never use, which is a note rather than a fault.
    /// </summary>
    /// <remarks>
    /// A marker is what the station counts to decide a break came back in character, and the samples
    /// are the model's evidence for how to use one, so a marker in none of them asks for a word the model
    /// has only been told about. A sheet with no samples makes no claim either way, so it says nothing.
    /// A plain substring, which is what a marker ending in an apostrophe wants: <c>in'</c> is found in
    /// <c>talkin'</c> here as it is on air.
    /// </remarks>
    public IReadOnlyList<string> UnusedMarkers()
    {
        var written = Samples.Trim().ToLowerInvariant();
        if (written.Length == 0)
        {
            return [];
        }

        return (ListOf(DictionMarkers) ?? [])
            .Where(marker => !written.Contains(marker.ToLowerInvariant(), StringComparison.Ordinal))
            .ToList();
    }

    private static string? Text(string raw) => raw.Trim().Length == 0 ? null : raw.Trim();

    private static string OrdinaryIsAbsent(string word) => word == "ordinary" ? string.Empty : word;

    private static string OccasionallyIsAbsent(string word) => word == "occasionally" ? string.Empty : word;

    private static string ProposesIsAbsent(string word) => word == "proposes" ? string.Empty : word;
}
