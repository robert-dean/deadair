using System.Collections.ObjectModel;
using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One rung of a dial: the station's word for it, and what the operator reads.</summary>
public sealed record DialOption(string Value, string Label);

/// <summary>A host a caller may ring in to.</summary>
public sealed partial class HostChoiceViewModel(string id, string label, bool chosen) : ObservableObject
{
    public string Id { get; } = id;

    public string Label { get; } = label;

    [ObservableProperty]
    private bool _isChosen = chosen;
}

/// <summary>
/// One character's sheet, on its own page.
/// </summary>
/// <remarks>
/// <para>
/// A page rather than a dialog because a sheet is nineteen fields and is read whole: a field behind a
/// tab is a field an author does not know is there, and a dialog is a tall column in the middle of a
/// dimmed window. The page scrolls and Save does not: the way out is never fourteen boxes away.
/// </para>
/// <para>
/// What a character is FOR is fixed for the life of the page rather than a field. It decides which half
/// of the roster it lands in and whether it can ever present, and flipping it under a character an
/// operator has already cast would be a quieter change than it looks.
/// </para>
/// <para>
/// Only a NEW character can be started from a description. On an existing one the same button would
/// overwrite somebody's own work with no way back, and "regenerate this character" is a different
/// feature from "start me off".
/// </para>
/// </remarks>
public sealed partial class PersonaDetailViewModel : ObservableObject
{
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly StationUrl _station;
    private readonly PreviewsViewModel _previews;
    private readonly NavigationViewModel _navigation;
    private readonly CharactersViewModel _owner;
    private PersonaSheet _saved;

    /// <summary>Whether the key is the operator's own word or one this page derived from the name.</summary>
    /// <remarks>
    /// Not a comparison against the derived value: somebody who happens to type the slug this would
    /// have written still owns it, and would otherwise watch it follow the next name they typed.
    /// </remarks>
    private bool _ownKey;
    private bool _loading;

    public PersonaDetailViewModel(
        OperatorActions actions,
        HttpClient http,
        StationUrl station,
        PreviewsViewModel previews,
        NavigationViewModel navigation,
        CharactersViewModel owner,
        Persona? persona,
        PersonaKind kind)
    {
        ArgumentNullException.ThrowIfNull(previews);
        ArgumentNullException.ThrowIfNull(owner);

        _actions = actions;
        _http = http;
        _station = station;
        _previews = previews;
        _navigation = navigation;
        _owner = owner;
        Persona = persona;
        Kind = kind;
        _ownKey = persona is not null;
        _saved = persona is null ? new PersonaSheet() : PersonaSheet.From(persona);

        foreach (var host in owner.Roster.Where(row => PersonaRoster.KindOf(row) == PersonaKind.Host))
        {
            var choice = new HostChoiceViewModel(host.Id, host.Label, persona?.Hosts?.Contains(host.Id) == true);
            choice.PropertyChanged += (_, _) => IsDirty = !Current().SameAs(_saved);
            Hosts.Add(choice);
        }

        foreach (var voice in owner.Voices)
        {
            VoiceChoices.Add(voice.Id);
        }

        Fill(_saved);

        PropertyChanged += OnEdited;
    }

    /// <summary>The character being edited, or null for a new one.</summary>
    public Persona? Persona { get; }

    public PersonaKind Kind { get; }

    public bool IsNew => Persona is null;

    public bool IsCaller => Kind == PersonaKind.Caller;

    public bool IsHost => !IsCaller;

    public string Title => Persona is null ? IsCaller ? "New caller" : "New host" : $"Edit {Persona.Label}";

    public string Subtitle => IsCaller
        ? "A caller never presents. It is cast into a production when one wants somebody on the phone."
        : "Saving is heard on the next break the station writes. One already written or being spoken keeps the words it has.";

    public ObservableCollection<HostChoiceViewModel> Hosts { get; } = [];

    public bool HasHosts => Hosts.Count > 0;

    /// <summary>The voices the engine has, as the ids a sheet stores. Empty when no speech plugin answers.</summary>
    public ObservableCollection<string> VoiceChoices { get; } = [];

    public bool HasVoiceChoices => VoiceChoices.Count > 0;

    public string VoiceHelp => HasVoiceChoices
        ? "Leave empty for whatever the speech plugin uses by default."
        : "No speech plugin is answering, so this is the id as your engine will map it.";

    /// <summary>The station's sets of sounds, by key. Suggestions rather than a list: a set about to be made stays typeable.</summary>
    public ObservableCollection<string> SoundboardChoices { get; } = [];

    public static IReadOnlyList<DialOption> BrevityOptions { get; } =
    [
        new(string.Empty, "The station's usual"),
        new("short", "Says less: a sentence or two"),
        new("one-line", "Says almost nothing: one line"),
    ];

    public static IReadOnlyList<DialOption> LatitudeOptions { get; } =
    [
        new(string.Empty, "The station's usual discipline"),
        new("loose", "Room: follows a thought where it goes"),
        new("unleashed", "Off the leash, and says it however they like"),
    ];

    public static IReadOnlyList<DialOption> TriviaOptions { get; } =
    [
        new(string.Empty, "The station's usual: a note now and then"),
        new("keen", "Keen: the story behind every record"),
    ];

    public static IReadOnlyList<DialOption> StorytellingOptions { get; } =
    [
        new(string.Empty, "Occasionally: when nothing is known about the records"),
        new("often", "Often: most breaks"),
        new("never", "Never in a link"),
    ];

    public static IReadOnlyList<DialOption> GrowthOptions { get; } =
    [
        new(string.Empty, "Proposes: you approve anything new"),
        new("self-directed", "Self-directed: it keeps what it writes"),
    ];

    public static IReadOnlyList<DialOption> ChattinessOptions { get; } =
    [
        new(string.Empty, "Ordinary: the station's own interval"),
        new("relentless", "Relentless: twice as often"),
        new("chatty", "Chatty: a little more often"),
        new("sparing", "Sparing: a little less often"),
        new("reserved", "Reserved: half as often"),
    ];

    [ObservableProperty]
    private string _label = string.Empty;

    [ObservableProperty]
    private string _key = string.Empty;

    [ObservableProperty]
    private string _style = string.Empty;

    [ObservableProperty]
    private string _djName = string.Empty;

    [ObservableProperty]
    private string _background = string.Empty;

    [ObservableProperty]
    private string _diction = string.Empty;

    [ObservableProperty]
    private string _dictionMarkers = string.Empty;

    [ObservableProperty]
    private string _quirks = string.Empty;

    [ObservableProperty]
    private string _catchphrases = string.Empty;

    [ObservableProperty]
    private string _avoid = string.Empty;

    [ObservableProperty]
    private string _exclusiveSubjects = string.Empty;

    [ObservableProperty]
    private string _templates = string.Empty;

    [ObservableProperty]
    private string _samples = string.Empty;

    [ObservableProperty]
    private string _voice = string.Empty;

    [ObservableProperty]
    private string _soundboard = string.Empty;

    [ObservableProperty]
    private string _preoccupations = string.Empty;

    [ObservableProperty]
    private DialOption _brevity = BrevityOptions[0];

    [ObservableProperty]
    private DialOption _latitude = LatitudeOptions[0];

    [ObservableProperty]
    private DialOption _trivia = TriviaOptions[0];

    [ObservableProperty]
    private DialOption _storytelling = StorytellingOptions[0];

    [ObservableProperty]
    private DialOption _growth = GrowthOptions[0];

    [ObservableProperty]
    private DialOption _chattiness = ChattinessOptions[0];

    /// <summary>What a new character is to be, in the operator's words, for the model to fill the fields from.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(GenerateCommand))]
    private string _description = string.Empty;

    /// <summary>What the station dropped out of what the model wrote, or null.</summary>
    [ObservableProperty]
    private string? _dropped;

    [ObservableProperty]
    private string? _problem;

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private bool _isDirty;

    public string KeyHelp => _ownKey
        ? "A short slug, unique to this station."
        : "A short slug, unique to this station. Follows the name until you write your own.";

    public string DescriptionPlaceholder => IsCaller
        ? "a taxi driver who rings in every week to argue about the charts"
        : "a 1970s northern soul DJ who broadcasts from the back of a chip shop";

    /// <summary>What the dials come to together, which none of them can say alone.</summary>
    public string Readout => PersonaReadout.Describe(Brevity.Value, Latitude.Value, Storytelling.Value, Chattiness.Value, Trivia.Value);

    /// <summary>The phrasings the station would never pick, one per line, or null.</summary>
    public string? TemplateFaults =>
        PersonaReadout.Faults(Templates) is { Count: > 0 } faults
            ? string.Join('\n', faults.Select(fault => $"{Shorten(fault.Line)} {fault.Fault}."))
            : null;

    /// <summary>Markers the samples never use, which is a note rather than a warning.</summary>
    public string? UnusedMarkers =>
        Current().UnusedMarkers() is { Count: > 0 } unused
            ? $"Nothing in the lines above uses {string.Join(", ", unused)}. A break is refused for carrying none of these words, "
                + "so it is worth showing the model at least one of them in use."
            : null;

    public bool IsVoicePlaying => Voice.Length > 0 && _previews.Playing == CharactersViewModel.VoiceKey(Voice);

    public string VoicePlayLabel => IsVoicePlaying ? "Stop" : "Hear";

    public static string Rules =>
        "Nothing here can loosen the rules the station always sends: never name a record it was not given, and be certain or "
        + "say nothing.";

    /// <summary>Reads the sets a character can reach for; the roster and voices came with the tab.</summary>
    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        var pads = await _actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                return await sdk.Render.ListPadsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        SoundboardChoices.Clear();
        foreach (var set in pads?.Sets ?? [])
        {
            SoundboardChoices.Add(set.Key);
        }
    }

    /// <summary>
    /// Fills the fields from a description, and saves nothing.
    /// </summary>
    /// <remarks>
    /// Disabled while one is in flight as well as while there is nothing to send: a second press starts
    /// a second generation whose answer can land after the first. What arrives is a starting point to
    /// edit, and the model names the character, so its key is its own from then on.
    /// </remarks>
    [RelayCommand(CanExecute = nameof(CanGenerate))]
    private async Task GenerateAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var written = await _actions.RunAsync(
                async token =>
                {
                    using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                    return await sdk.Personas.GeneratePersonaAsync(new PersonaRequest { Description = Description.Trim() }, token)
                        .ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (written is null)
            {
                return;
            }

            _ownKey = true;
            Fill(PersonaSheet.From(written.Persona));
            Dropped = DroppedWords(written);
        }
        finally
        {
            Busy = false;
        }
    }

    private bool CanGenerate() => IsNew && Description.Trim().Length > 0 && !Busy;

    partial void OnBusyChanged(bool value) => GenerateCommand.NotifyCanExecuteChanged();

    /// <summary>What the station had to leave out of a generated character, said rather than quietly applied.</summary>
    public static string? DroppedWords(GeneratedPersona written)
    {
        ArgumentNullException.ThrowIfNull(written);

        var parts = new List<string>();
        if (written.DroppedMarkers.Count > 0)
        {
            parts.Add($"The model called these words its own and then never used them, so they were left out: "
                + $"{string.Join(", ", written.DroppedMarkers)}. A word the character does not actually say would refuse every break it writes.");
        }

        if (written.DroppedTemplates.Count > 0)
        {
            parts.Add(written.DroppedTemplates.Count == 1
                ? "One phrasing named something the station cannot fill in, so it was left out."
                : $"{written.DroppedTemplates.Count} phrasings named something the station cannot fill in, so they were left out.");
        }

        return parts.Count == 0 ? null : string.Join(' ', parts);
    }

    [RelayCommand]
    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        var sheet = Current();
        if (sheet.Problem() is { } problem)
        {
            Problem = problem;
            return;
        }

        Problem = null;
        Busy = true;
        try
        {
            var input = sheet.ToInput(Kind);
            var taken = new Dictionary<int, string> { [409] = $"Another character already has the key \"{input.Key}\"." };
            var list = await _actions.RunAsync(
                async token =>
                {
                    using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                    return Persona is null
                        ? await sdk.Personas.CreatePersonaAsync(input, token).ConfigureAwait(false)
                        : await sdk.Personas.UpdatePersonaAsync(Persona.Id, input, token).ConfigureAwait(false);
                },
                taken,
                cancellationToken).ConfigureAwait(true);

            if (list is null)
            {
                return;
            }

            _saved = sheet;
            IsDirty = false;
            _owner.Present(list);
            _owner.Notice = Persona is null ? $"Wrote {input.Label}." : $"Saved {input.Label}. It is heard on the next break.";
            _navigation.Back();
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Leaves, and says nothing: a page opened and read is closed without a question.</summary>
    [RelayCommand]
    private void Cancel() => _navigation.Back();

    /// <summary>
    /// Suggests an on-air name. A button rather than a prefilled value: empty means "keep the
    /// station's name", which is a real answer a suggestion may not quietly overwrite.
    /// </summary>
    [RelayCommand]
    private void SuggestDjName() => DjName = AirNames.Suggest(DjName, Random.Shared);

    /// <summary>Plays whatever voice is chosen, since a voice is chosen by ear or not at all.</summary>
    [RelayCommand]
    private async Task PlayVoiceAsync()
    {
        if (Voice.Length > 0)
        {
            await _owner.ToggleVoiceAsync(Voice).ConfigureAwait(true);
            OnPropertyChanged(nameof(IsVoicePlaying));
            OnPropertyChanged(nameof(VoicePlayLabel));
        }
    }

    /// <summary>The fields as a sheet.</summary>
    public PersonaSheet Current() => new()
    {
        Key = Key,
        Label = Label,
        Style = Style,
        DjName = DjName,
        Voice = Voice,
        Soundboard = Soundboard,
        Background = Background,
        Brevity = Brevity.Value,
        Latitude = Latitude.Value,
        Chattiness = Chattiness.Value,
        Storytelling = Storytelling.Value,
        Growth = Growth.Value,
        Trivia = Trivia.Value,
        Templates = Templates,
        Diction = Diction,
        DictionMarkers = DictionMarkers,
        Quirks = Quirks,
        Preoccupations = Preoccupations,
        Catchphrases = Catchphrases,
        Avoid = Avoid,
        ExclusiveSubjects = ExclusiveSubjects,
        Samples = Samples,
        Hosts = Hosts.Where(host => host.IsChosen).Select(host => host.Id).ToList(),
    };

    private void Fill(PersonaSheet sheet)
    {
        _loading = true;
        try
        {
            Label = sheet.Label;
            Key = sheet.Key;
            Style = sheet.Style;
            DjName = sheet.DjName;
            Background = sheet.Background;
            Diction = sheet.Diction;
            DictionMarkers = sheet.DictionMarkers;
            Quirks = sheet.Quirks;
            Catchphrases = sheet.Catchphrases;
            Avoid = sheet.Avoid;
            ExclusiveSubjects = sheet.ExclusiveSubjects;
            Templates = sheet.Templates;
            Samples = sheet.Samples;
            Voice = sheet.Voice;
            Soundboard = sheet.Soundboard;
            Preoccupations = sheet.Preoccupations;
            Brevity = Pick(BrevityOptions, sheet.Brevity);
            Latitude = Pick(LatitudeOptions, sheet.Latitude);
            Trivia = Pick(TriviaOptions, sheet.Trivia);
            Storytelling = Pick(StorytellingOptions, sheet.Storytelling);
            Growth = Pick(GrowthOptions, sheet.Growth);
            Chattiness = Pick(ChattinessOptions, sheet.Chattiness);
        }
        finally
        {
            _loading = false;
        }

        IsDirty = !Current().SameAs(_saved);
    }

    private static DialOption Pick(IReadOnlyList<DialOption> options, string value) =>
        options.FirstOrDefault(option => option.Value == value) ?? options[0];

    private void OnEdited(object? sender, PropertyChangedEventArgs e)
    {
        if (_loading)
        {
            return;
        }

        switch (e.PropertyName)
        {
            // The key follows the name until somebody says otherwise, and never on a character that
            // exists: the key is what the script history stamps.
            case nameof(Label) when !_ownKey:
                Key = PersonaSheet.KeyFor(Label);
                break;
            case nameof(Key) when Key != PersonaSheet.KeyFor(Label):
                _ownKey = true;
                OnPropertyChanged(nameof(KeyHelp));
                break;
            case nameof(Brevity) or nameof(Latitude) or nameof(Storytelling) or nameof(Chattiness) or nameof(Trivia):
                OnPropertyChanged(nameof(Readout));
                break;
            case nameof(Templates):
                OnPropertyChanged(nameof(TemplateFaults));
                break;
            case nameof(Samples) or nameof(DictionMarkers):
                OnPropertyChanged(nameof(UnusedMarkers));
                break;
            case nameof(Voice):
                OnPropertyChanged(nameof(IsVoicePlaying));
                OnPropertyChanged(nameof(VoicePlayLabel));
                break;
        }

        if (e.PropertyName is not (nameof(IsDirty) or nameof(Problem) or nameof(Busy) or nameof(Dropped) or nameof(Description)
            or nameof(Readout) or nameof(TemplateFaults) or nameof(UnusedMarkers) or nameof(KeyHelp)
            or nameof(IsVoicePlaying) or nameof(VoicePlayLabel)))
        {
            IsDirty = !Current().SameAs(_saved);
        }
    }

    private static string Shorten(string line) => line.Length > 80 ? $"{line[..80]}…" : line;
}
