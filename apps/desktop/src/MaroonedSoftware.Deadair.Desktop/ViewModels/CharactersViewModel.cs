using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk.Models;
using Nav = MaroonedSoftware.Deadair.Desktop.Navigation;
using VoiceModel = MaroonedSoftware.Deadair.Sdk.Models.Voice;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One character on the Characters tab.
/// </summary>
/// <remarks>
/// <see cref="Presenting"/> is who is writing breaks right now; <see cref="IsStationHost"/> is who
/// presents when the broadcast on air names nobody. They are the same character until a show names its
/// own host, which is exactly when somebody is looking at this tab, so they are two badges.
/// </remarks>
public sealed partial class PersonaRowViewModel : ObservableObject
{
    public PersonaRowViewModel(
        Persona persona,
        string? heading = null,
        string? voiceLine = null,
        string? summary = null,
        string? ringsIn = null,
        string? record = null)
    {
        ArgumentNullException.ThrowIfNull(persona);

        Persona = persona;
        Heading = heading;
        VoiceLine = voiceLine;
        Summary = summary;
        RingsIn = ringsIn;
        Record = record;
    }

    public Persona Persona { get; }

    public string Id => Persona.Id;

    public string Label => Persona.Label;

    public string Style => Persona.Style;

    /// <summary>The on-air name, when it has one of its own.</summary>
    public string? DjName => string.IsNullOrEmpty(Persona.DjName) ? null : Persona.DjName;

    public bool IsCaller => PersonaRoster.KindOf(Persona) == PersonaKind.Caller;

    public bool IsStationHost => Persona.DefaultHost;

    public bool Presenting => Persona.Presenting;

    /// <summary>The station's own host, when somebody else is speaking for a show.</summary>
    public bool ShowsStationsOwn => Persona.DefaultHost && !Persona.Presenting;

    /// <summary>
    /// Not offered for a caller at all, rather than offered and refused: somebody who phones in cannot
    /// present the station, and the station says so.
    /// </summary>
    public bool CanMakeHost => !Persona.DefaultHost && !IsCaller;

    /// <summary>"Hosts" or "Callers" above the first card of each half, and null on every other.</summary>
    public string? Heading { get; }

    public bool HasHeading => Heading is not null;

    /// <summary>Which voice it speaks in, with what the engine says that voice sounds like.</summary>
    public string? VoiceLine { get; }

    public bool HasVoice => VoiceLine is not null;

    public string? Summary { get; }

    public string? RingsIn { get; }

    /// <summary>How it has done on air lately, or null when it has made no attempts.</summary>
    public string? Record { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PlayLabel))]
    private bool _isPlaying;

    public string PlayLabel => IsPlaying ? "Stop" : "Hear";
}

/// <summary>
/// Who the station is when it opens its mouth: the roster, and every way in and out of it.
/// </summary>
/// <remarks>
/// <para>
/// A character is edited on its own page (<see cref="PersonaDetailViewModel"/>) rather than in a
/// dialog: a sheet is nineteen fields, read whole, and a dialog made it a tall column in the middle of
/// a dimmed page. The roster is read again when the page comes back, so a save is on the card at once.
/// </para>
/// <para>
/// A change is heard on the NEXT break. Breaks are written a little ahead of their slot, so whatever is
/// already rendered airs in the character it was written in.
/// </para>
/// </remarks>
public sealed partial class CharactersViewModel(
    OperatorActions actions,
    HttpClient http,
    IDialogs dialogs,
    PreviewsViewModel previews,
    IFilePicker files,
    NavigationViewModel navigation) : VoiceTabViewModel(actions, http)
{
    /// <summary>The window the on-air record on each card covers.</summary>
    private const long SummaryHours = 24;

    private List<Persona> _roster = [];
    private List<ScriptHistorySummaryRow> _counts = [];

    public ObservableCollection<PersonaRowViewModel> Rows { get; } = [];

    /// <summary>What the speech plugin can speak in, for the voice lines and the editor's picker.</summary>
    public IReadOnlyList<VoiceModel> Voices { get; private set; } = [];

    /// <summary>The whole roster, for a caller's ties and the other tabs' pickers.</summary>
    public IReadOnlyList<Persona> Roster => _roster;

    [ObservableProperty]
    private string _filter = string.Empty;

    /// <summary>Only once the roster is long enough to be worth sieving.</summary>
    public bool ShowsFilter => _roster.Count > PersonaRoster.FilterFrom;

    /// <summary>Said when the roster is empty or the filter matches nothing, and null otherwise.</summary>
    public string? Empty =>
        Busy || Rows.Count > 0 ? null
        : _roster.Count == 0 ? "This station has no personas, which is an ordinary state rather than a fault: it writes its breaks "
            + "from the station's own phrasings and speaks them in the plugin's default voice. Write one to give it a character."
        : "No character here matches that. Clear the box to see the whole roster again.";

    partial void OnFilterChanged(string value) => Redraw();

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Personas.ListPersonasAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is null)
        {
            return;
        }

        // What the voices sound like and how each character is doing on air. One call each for the
        // whole roster, since a card each would open this tab with nineteen requests. Neither is
        // worth a refusal at the foot of the page: a station with no speech plugin still has a roster.
        var voices = await RunAsync((sdk, token) => sdk.Render.ListVoicesAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);
        var summary = await RunAsync(
            (sdk, token) => sdk.Render.ReadScriptSummaryAsync(new ScriptHistorySummaryQuery { Hours = SummaryHours }, token),
            cancellationToken: cancellationToken).ConfigureAwait(true);

        Voices = voices?.Voices ?? Voices;
        _counts = summary?.Rows ?? _counts;
        Present(list);
    }

    /// <summary>Draws a roster the station answered with. Every write answers the whole list.</summary>
    public void Present(PersonaList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        _roster = [.. list.Personas];
        OnPropertyChanged(nameof(ShowsFilter));
        OnPropertyChanged(nameof(Roster));
        Redraw();
    }

    /// <summary>Poses the tab with rows made elsewhere, for a picture of it.</summary>
    public void Pose(IEnumerable<Persona> roster, IReadOnlyList<VoiceModel> voices)
    {
        ArgumentNullException.ThrowIfNull(roster);
        ArgumentNullException.ThrowIfNull(voices);

        Voices = voices;
        _roster = [.. roster];
        OnPropertyChanged(nameof(ShowsFilter));
        Redraw();
    }

    private void Redraw()
    {
        var shown = PersonaRoster.Order(_roster).Where(persona => PersonaRoster.Matches(persona, Filter)).ToList();

        Rows.Clear();
        PersonaKind? last = null;
        foreach (var persona in shown)
        {
            // A heading at each changeover rather than two lists: the roster is already ordered hosts
            // then callers, so one comparison with the card above is the whole of it.
            var kind = PersonaRoster.KindOf(persona);
            var heading = kind == last ? null : kind == PersonaKind.Caller ? "Callers" : "Hosts";
            last = kind;

            Rows.Add(new PersonaRowViewModel(
                persona,
                heading,
                VoiceLine(persona.Voice),
                PersonaRoster.Summary(persona),
                PersonaRoster.RingsIn(persona, _roster),
                PersonaRoster.Record(_counts.FirstOrDefault(row => row.PersonaKey == persona.Key), SummaryHours))
            {
                IsPlaying = persona.Voice is { } voice && previews.Playing == VoiceKey(voice),
            });
        }

        OnPropertyChanged(nameof(Empty));
    }

    /// <summary>
    /// A voice as something an operator can hear in their head, or as the word they typed.
    /// </summary>
    /// <remarks>
    /// The station's voice id is a name this station chose and the engine has never heard of, so on
    /// its own it says nothing about the sound; the plugin's description does, and it is absent exactly
    /// when nothing can speak.
    /// </remarks>
    private string? VoiceLine(string? voiceId)
    {
        if (string.IsNullOrEmpty(voiceId))
        {
            return null;
        }

        var voice = Voices.FirstOrDefault(candidate => candidate.Id == voiceId);
        return voice?.Description is { Length: > 0 } description ? $"speaks as {voiceId}, {description}" : $"speaks as {voiceId}";
    }

    [RelayCommand]
    private void NewHost() => navigation.Push(new Nav.Destination.PersonaDetail(null, "New host", Caller: false));

    [RelayCommand]
    private void NewCaller() => navigation.Push(new Nav.Destination.PersonaDetail(null, "New caller", Caller: true));

    [RelayCommand]
    private void Edit(PersonaRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);
        navigation.Push(new Nav.Destination.PersonaDetail(row.Id, row.Label, row.IsCaller));
    }

    /// <summary>Builds the page for one character, or for a new one.</summary>
    public PersonaDetailViewModel Open(Nav.Destination.PersonaDetail destination)
    {
        ArgumentNullException.ThrowIfNull(destination);

        var persona = destination.Id is null ? null : _roster.FirstOrDefault(row => row.Id == destination.Id);
        var page = new PersonaDetailViewModel(
            Actions,
            Http,
            Station,
            previews,
            navigation,
            this,
            persona,
            destination.Caller ? PersonaKind.Caller : PersonaKind.Host);
        page.LoadCommand.Execute(null);
        return page;
    }

    /// <remarks>
    /// The notice says what actually happened, because this is the station's own host rather than the
    /// show's: a broadcast that named its own keeps it until that show ends.
    /// </remarks>
    [RelayCommand]
    private async Task MakeStationHostAsync(PersonaRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var list = await RunAsync((sdk, token) => sdk.Personas.SetTheStationHostAsync(row.Id, token)).ConfigureAwait(true);
        if (list is not null)
        {
            Notice = $"{row.Label} is the station's host now.";
            Present(list);
        }
    }

    /// <remarks>
    /// Safe to press twice: it writes only what is missing, overwrites nothing an operator rewrote, and
    /// puts nothing on air, which is what keeps it a plain button rather than a question.
    /// </remarks>
    [RelayCommand]
    private async Task RestoreAsync()
    {
        var list = await RunAsync((sdk, token) => sdk.Personas.RestoreStationPersonasAsync(token)).ConfigureAwait(true);
        if (list is not null)
        {
            Notice = "The station's own characters are back. Nothing you wrote was touched, and nobody was put on air.";
            Present(list);
        }
    }

    /// <summary>
    /// Asks, and says what goes with the character: its notebook is counted rather than mentioned,
    /// because "the four notes in its notebook" is a sentence somebody reads.
    /// </summary>
    [RelayCommand]
    private async Task DeleteAsync(PersonaRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var notes = await RunAsync((sdk, token) => sdk.Personas.ListPersonaNotesAsync(row.Id, token)).ConfigureAwait(true);
        var count = notes?.Notes.Count ?? 0;
        var notebook = count switch
        {
            0 => string.Empty,
            1 => ", and the 1 note in its notebook",
            _ => $", and the {count} notes in its notebook",
        };

        if (!await dialogs.ConfirmAsync(
                $"Delete {row.Label}?",
                $"Its sheet goes, and so do its own phrasings{notebook}. Anything it has already written keeps the words it has. "
                + "The station's own characters can be written back with Restore built-ins; one you wrote yourself cannot.",
                "Delete").ConfigureAwait(true))
        {
            return;
        }

        var list = await RunAsync((sdk, token) => sdk.Personas.DeletePersonaAsync(row.Id, token)).ConfigureAwait(true);
        if (list is not null)
        {
            Notice = $"Deleted {row.Label}.";
            Present(list);
        }
    }

    /// <summary>
    /// The whole roster as one file: a backup to keep, and the shape somebody else's station can read.
    /// It carries no id and nothing about who is on air.
    /// </summary>
    [RelayCommand]
    private async Task ExportAllAsync()
    {
        var export = await RunAsync((sdk, token) => sdk.Personas.ExportPersonasAsync(token)).ConfigureAwait(true);
        if (export is not null
            && await files.SaveAsync(
                "Export personas",
                PersonaRoster.FileName(export.Headers.ContentDisposition, "personas.json"),
                PersonaRoster.Serialize(export.Data)).ConfigureAwait(true))
        {
            Notice = $"Saved {export.Data.Personas.Count} characters.";
        }
    }

    /// <summary>One character, its sheet and its stories.</summary>
    [RelayCommand]
    private async Task ExportAsync(PersonaRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var export = await RunAsync((sdk, token) => sdk.Personas.ExportPersonaAsync(row.Id, token)).ConfigureAwait(true);
        if (export is not null
            && await files.SaveAsync(
                $"Export {row.Label}",
                PersonaRoster.FileName(export.Headers.ContentDisposition, $"{row.Persona.Key}.json"),
                PersonaRoster.Serialize(export.Data)).ConfigureAwait(true))
        {
            Notice = $"Saved {row.Label}.";
        }
    }

    /// <summary>
    /// Chooses a file, reads what importing it would do, and asks.
    /// </summary>
    /// <remarks>
    /// The preview is not a confirmation step. The plan it shows is the DECISION (the import runs the
    /// same function to make it), and its notices are the only place a voice this engine does not map,
    /// a rack this station does not hold or a phrasing it can never fill is ever said out loud.
    /// </remarks>
    [RelayCommand]
    private async Task ImportAsync()
    {
        var picked = await files.OpenAsync("Import personas", ["*.json"]).ConfigureAwait(true);
        if (picked is null)
        {
            return;
        }

        if (PersonaRoster.Read(picked.Data) is not { } file)
        {
            Notice = $"\"{picked.Name}\" is not a file this can read. A persona file is the JSON one of these pages saved.";
            return;
        }

        var plan = await RunAsync(
            (sdk, token) => sdk.Personas.PreviewPersonaImportAsync(file, token),
            new Dictionary<int, string> { [422] = $"\"{picked.Name}\" is JSON, but not a persona file this station recognises." })
            .ConfigureAwait(true);

        if (plan is null)
        {
            return;
        }

        var dialog = new PersonaImportDialogViewModel(Actions, Http, Station, picked.Name, file, plan);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } result)
        {
            Notice = PersonaRoster.Imported(result);
            Present(result.Personas);
        }
    }

    /// <summary>Plays a sample of the voice a character speaks in, or stops it.</summary>
    [RelayCommand]
    private async Task PlayVoiceAsync(PersonaRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (row.Persona.Voice is { Length: > 0 } voice)
        {
            await ToggleVoiceAsync(voice).ConfigureAwait(true);
        }
    }

    /// <summary>Plays a sample of one voice through the app's one preview, or stops it.</summary>
    public async Task ToggleVoiceAsync(string voiceId)
    {
        ArgumentNullException.ThrowIfNull(voiceId);

        await previews.ToggleAsync(
            VoiceKey(voiceId),
            async token => Clips.From(await RunAsync<object>(
                async (sdk, inner) => await sdk.Render.GetVoiceSampleAsync(voiceId, inner).ConfigureAwait(false),
                new Dictionary<int, string> { [404] = "That voice could not be previewed: the engine does not know it." },
                token).ConfigureAwait(true))).ConfigureAwait(true);

        foreach (var row in Rows)
        {
            row.IsPlaying = row.Persona.Voice is { } voice && previews.Playing == VoiceKey(voice);
        }
    }

    /// <summary>The preview key for a voice sample, shared with the editor so the two agree on what is playing.</summary>
    public static string VoiceKey(string voiceId) => $"voice:{voiceId}";
}
