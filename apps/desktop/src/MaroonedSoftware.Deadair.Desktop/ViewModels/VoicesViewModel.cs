using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk.Models;
using VoiceModel = MaroonedSoftware.Deadair.Sdk.Models.Voice;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One voice the station can speak in.</summary>
public sealed partial class VoiceRowViewModel(string id, string label, string? description, string spokenBy) : ObservableObject
{
    public string Id { get; } = id;

    public string Label { get; } = label;

    public string? Description { get; } = description;

    /// <summary>Who speaks in it, which is the other half of what a station voice IS.</summary>
    public string SpokenBy { get; } = spokenBy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PlayLabel))]
    private bool _isPlaying;

    public string PlayLabel => IsPlaying ? "Stop" : "Hear";
}

/// <summary>
/// The voices the station can speak in, each heard by ear.
/// </summary>
/// <remarks>
/// <para>
/// A sample is a PREVIEW and never something that can air: it has no row among the segments, so
/// nothing can plant it or name it in a lineup. The bytes come through the one station client because
/// the sample route wants the operator's token.
/// </para>
/// <para>
/// What a voice maps to lives in the speech plugin's own settings, which is the only thing that knows
/// its engine's words, so this tab says which plugin that is and does not edit the mapping. A station
/// voice id is a persona key everywhere else, so each row says who speaks in it.
/// </para>
/// </remarks>
public sealed partial class VoicesViewModel(OperatorActions actions, HttpClient http, PreviewsViewModel previews)
    : VoiceTabViewModel(actions, http)
{
    /// <summary>The station voice the news is read in, whoever is presenting.</summary>
    private const string Newsreader = "newsreader";

    private const string DefaultKey = "voice-default";

    private const string SpokenKey = "voice-typed";

    public ObservableCollection<VoiceRowViewModel> Voices { get; } = [];

    /// <summary>The voices to speak typed words in, the plugin's default first.</summary>
    public ObservableCollection<ChoiceViewModel> SpeakIn { get; } = [];

    /// <summary>Where the mapping is set, or null when nothing can speak.</summary>
    [ObservableProperty]
    private string? _spokenBy;

    /// <summary>Why nothing can speak, in the station's words. Not an error: a station with no voice plays records.</summary>
    [ObservableProperty]
    private string? _empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DefaultLabel))]
    private bool _isDefaultPlaying;

    public string DefaultLabel => IsDefaultPlaying ? "Stop" : "Hear";

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SpeakCommand))]
    private string _words = string.Empty;

    [ObservableProperty]
    private ChoiceViewModel? _speakWith;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SpeakLabel))]
    private bool _isSpeaking;

    public string SpeakLabel => IsSpeaking ? "Stop" : "Speak";

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var voices = await RunAsync((sdk, token) => sdk.Render.ListVoicesAsync(token), cancellationToken: cancellationToken).ConfigureAwait(true);
        var roster = await RunAsync((sdk, token) => sdk.Personas.ListPersonasAsync(token), cancellationToken: cancellationToken).ConfigureAwait(true);

        if (voices is not null)
        {
            Present(voices, roster?.Personas ?? []);
        }
    }

    public void Present(VoiceList list, IReadOnlyList<Persona> roster)
    {
        ArgumentNullException.ThrowIfNull(list);
        ArgumentNullException.ThrowIfNull(roster);

        SpokenBy = list.PluginId is { Length: > 0 } plugin
            ? $"Spoken by {plugin}. What each of these maps to is set in that plugin's own settings, and a voice that sounds wrong is a mapping to change there."
            : null;
        Empty = list.Voices.Count == 0 ? list.Reason ?? "No plugin is available to speak." : null;

        Voices.Clear();
        foreach (var voice in list.Voices)
        {
            Voices.Add(new VoiceRowViewModel(voice.Id, voice.Label, voice.Description, Speakers(voice, roster))
            {
                IsPlaying = previews.Playing == CharactersViewModel.VoiceKey(voice.Id),
            });
        }

        var chosen = SpeakWith?.Value;
        SpeakIn.Clear();
        SpeakIn.Add(new ChoiceViewModel(string.Empty, "The plugin's default voice"));
        foreach (var voice in list.Voices)
        {
            SpeakIn.Add(new ChoiceViewModel(voice.Id, voice.Label));
        }

        SpeakWith = SpeakIn.FirstOrDefault(choice => choice.Value == chosen) ?? SpeakIn[0];
    }

    /// <summary>
    /// Who speaks in a voice. A voice nothing uses says nothing rather than "unused": the row existing
    /// is already somebody saying they want it available.
    /// </summary>
    public static string Speakers(VoiceModel voice, IReadOnlyList<Persona> roster)
    {
        ArgumentNullException.ThrowIfNull(voice);
        ArgumentNullException.ThrowIfNull(roster);

        return voice.Id == Newsreader ? "the news" : string.Join(", ", roster.Where(persona => persona.Voice == voice.Id).Select(persona => persona.Label));
    }

    [RelayCommand]
    private async Task PlayAsync(VoiceRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        await previews.ToggleAsync(
            CharactersViewModel.VoiceKey(row.Id),
            async token => Clips.From(await RunAsync<object>(
                async (sdk, inner) => await sdk.Render.GetVoiceSampleAsync(row.Id, inner).ConfigureAwait(false),
                new Dictionary<int, string> { [404] = "That voice could not be previewed: the engine does not know it." },
                token).ConfigureAwait(true))).ConfigureAwait(true);

        Redraw();
    }

    /// <summary>Whatever the speech plugin speaks in when a character names no voice of its own.</summary>
    [RelayCommand]
    private async Task PlayDefaultAsync()
    {
        await previews.ToggleAsync(
            DefaultKey,
            async token => Clips.From(await RunAsync<object>(
                async (sdk, inner) => await sdk.Render.GetDefaultVoiceSampleAsync(inner).ConfigureAwait(false),
                cancellationToken: token).ConfigureAwait(true))).ConfigureAwait(true);

        Redraw();
    }

    /// <summary>
    /// Speaks typed words, which is how a name is checked before it is on air: the break that says it
    /// wrong has already gone out by the time anybody hears it.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanSpeak))]
    private async Task SpeakAsync()
    {
        var text = Words.Trim();
        var voice = SpeakWith?.Value is { Length: > 0 } chosen ? chosen : null;

        await previews.ToggleAsync(
            SpokenKey,
            async token => Clips.From(await RunAsync<object>(
                async (sdk, inner) => await sdk.Render.PreviewSpeechAsync(new SpeechPreviewRequest { Text = text, Voice = voice }, inner)
                    .ConfigureAwait(false),
                cancellationToken: token).ConfigureAwait(true))).ConfigureAwait(true);

        Redraw();
    }

    private bool CanSpeak() => Words.Trim().Length > 0;

    private void Redraw()
    {
        foreach (var row in Voices)
        {
            row.IsPlaying = previews.Playing == CharactersViewModel.VoiceKey(row.Id);
        }

        IsDefaultPlaying = previews.Playing == DefaultKey;
        IsSpeaking = previews.Playing == SpokenKey;
    }
}
