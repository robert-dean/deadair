using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using VoiceModel = MaroonedSoftware.Deadair.Sdk.Models.Voice;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>A segment for the station to write out loud: what it says, what it is, and in whose voice.</summary>
public sealed partial class SegmentComposeDialogViewModel : DialogViewModel
{
    /// <summary>What a new segment is unless somebody says otherwise: the kind most of them are.</summary>
    public const string DefaultKind = "talkbreak";

    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly StationUrl _station;

    public SegmentComposeDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station, IReadOnlyList<VoiceModel> voices)
    {
        ArgumentNullException.ThrowIfNull(voices);

        _actions = actions;
        _http = http;
        _station = station;
        Voices = [new ChoiceViewModel(string.Empty, "The plugin's default voice"), .. voices.Where(voice => voice.Id.Length > 0).Select(voice => new ChoiceViewModel(voice.Id, voice.Label))];
        _voice = Voices[0];
    }

    public override string Title => "Write a segment";

    public override string AcceptLabel => "Plan it";

    public override bool CanAccept => Label.Trim().Length > 0 && Script.Trim().Length > 0;

    public IReadOnlyList<ChoiceViewModel> Voices { get; }

    [ObservableProperty]
    private string _label = string.Empty;

    [ObservableProperty]
    private string _script = string.Empty;

    [ObservableProperty]
    private string _kind = DefaultKind;

    [ObservableProperty]
    private ChoiceViewModel _voice;

    partial void OnLabelChanged(string value) => Revalidate();

    partial void OnScriptChanged(string value) => Revalidate();

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var body = new SegmentCreate
        {
            Label = Label.Trim(),
            Script = Script.Trim(),
            Kind = Kind.Trim().Length == 0 ? DefaultKind : Kind.Trim(),
            Voice = Voice.Value.Length == 0 ? null : Voice.Value,
        };

        var created = await _actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                return await sdk.Render.CreateSegmentAsync(body, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        return created is not null;
    }
}

/// <summary>A recording from this Mac, filed under a kind and given the label it airs under.</summary>
public sealed partial class SegmentUploadDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly StationUrl _station;
    private readonly PickedFile _file;

    public SegmentUploadDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station, PickedFile file, IReadOnlyList<string> kinds)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(kinds);

        _actions = actions;
        _http = http;
        _station = station;
        _file = file;
        Kinds = kinds;
        _label = AudioFiles.LabelFor(file.Name);
        _kind = kinds.Contains("ident") ? "ident" : (kinds.Count > 0 ? kinds[0] : "ident");
    }

    public override string Title => "Upload a recording";

    public override string AcceptLabel => "Put it in the library";

    public override bool CanAccept => Label.Trim().Length > 0 && Kind.Trim().Length > 0;

    public string FileName => _file.Name;

    public IReadOnlyList<string> Kinds { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Unfamiliar))]
    private string _kind;

    [ObservableProperty]
    private string _label;

    /// <summary>A kind the station holds nothing of yet becomes an hour the format clock can schedule around, which is worth saying.</summary>
    public string? Unfamiliar => Kind.Trim().Length == 0 || Kinds.Contains(Kind.Trim())
        ? null
        : $"The station holds nothing of this kind yet, so {Kind.Trim()} will appear in the format clock as something you can schedule around once this is ready.";

    partial void OnKindChanged(string value) => Revalidate();

    partial void OnLabelChanged(string value) => Revalidate();

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var parts = new[]
        {
            SdkPart.Text("kind", Kind.Trim()),
            SdkPart.Text("label", Label.Trim()),
            SdkPart.File("file", _file.Data, _file.Name, AudioFiles.ContentType(_file.Name)),
        };

        var uploaded = await _actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                return await sdk.Render.UploadSegmentAsync(parts, token).ConfigureAwait(false);
            },
            new Dictionary<int, string>
            {
                [413] = "That recording is larger than the station takes (50 MB).",
                [415] = "The station does not take that kind of file. mp3, wav, ogg, flac or m4a.",
            },
            cancellationToken).ConfigureAwait(true);

        return uploaded is not null;
    }
}
