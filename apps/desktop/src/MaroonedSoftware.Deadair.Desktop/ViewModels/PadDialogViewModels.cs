using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>The station calls that every soundboard dialog makes the same way.</summary>
public abstract partial class PadDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station) : DialogViewModel
{
    /// <summary>The rack as it stands after the write, once it has worked.</summary>
    public PadList? Result { get; private set; }

    protected async Task<bool> WriteAsync(
        Func<DeadairSdk, CancellationToken, Task<PadList>> write,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<int, string>? expected = null)
    {
        Result = await actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(station, http);
                return await write(sdk, token).ConfigureAwait(false);
            },
            expected,
            cancellationToken).ConfigureAwait(true);

        return Result is not null;
    }
}

/// <summary>A sound from this Mac: the board it is filed under, what a script writes, and its label.</summary>
public sealed partial class PadUploadDialogViewModel : PadDialogViewModel
{
    private readonly PickedFile _file;

    public PadUploadDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station, PickedFile file, IReadOnlyList<string> boards)
        : base(actions, http, station)
    {
        ArgumentNullException.ThrowIfNull(file);

        _file = file;
        Boards = boards;
        _name = PadText.NameFor(file.Name);
        _label = AudioFiles.LabelFor(file.Name);
    }

    public override string Title => "Upload a sound";

    public override string AcceptLabel => $"Put it on the {Board.Trim()} board";

    public override bool CanAccept => Board.Trim().Length > 0 && PadText.Shape(Name).Length > 0;

    public string FileName => _file.Name;

    public IReadOnlyList<string> Boards { get; }

    [ObservableProperty]
    private string _board = PadText.DefaultBoard;

    /// <summary>What a script writes. Typed freely, and sent in the token's own shape, which the line under the box shows.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Token))]
    private string _name;

    [ObservableProperty]
    private string _label;

    public string Token => PadText.Token(PadText.Shape(Name) is { Length: > 0 } shaped ? shaped : "…");

    partial void OnBoardChanged(string value)
    {
        OnPropertyChanged(nameof(AcceptLabel));
        Revalidate();
    }

    partial void OnNameChanged(string value) => Revalidate();

    public override Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var parts = new[]
        {
            SdkPart.Text("board", Board.Trim()),
            SdkPart.Text("name", PadText.Shape(Name)),
            SdkPart.Text("label", Label.Trim().Length == 0 ? PadText.Shape(Name) : Label.Trim()),
            SdkPart.File("file", _file.Data, _file.Name, AudioFiles.ContentType(_file.Name)),
        };

        return WriteAsync(
            (sdk, token) => sdk.Render.UploadPadAsync(parts, token),
            cancellationToken,
            new Dictionary<int, string>
            {
                [413] = "That sound is larger than the station takes (25 MB).",
                [415] = "The station does not take that kind of file. mp3, wav, ogg, flac or m4a.",
            });
    }
}

/// <summary>A sound fetched from an address, once, and filed under a board.</summary>
public sealed partial class PadFetchDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station, IReadOnlyList<string> boards)
    : PadDialogViewModel(actions, http, station)
{
    public override string Title => "Fetch a sound";

    public override string AcceptLabel => "Fetch";

    public override bool CanAccept => Uri.TryCreate(Address.Trim(), UriKind.Absolute, out var uri)
        && uri.Scheme is "http" or "https"
        && Board.Trim().Length > 0;

    public IReadOnlyList<string> Boards { get; } = boards;

    [ObservableProperty]
    private string _address = string.Empty;

    [ObservableProperty]
    private string _board = PadText.DefaultBoard;

    partial void OnAddressChanged(string value) => Revalidate();

    partial void OnBoardChanged(string value) => Revalidate();

    public override Task<bool> AcceptAsync(CancellationToken cancellationToken) =>
        WriteAsync(
            (sdk, token) => sdk.Render.FetchPadAsync(new PadFetch { Url = Address.Trim(), Board = Board.Trim() }, token),
            cancellationToken,
            new Dictionary<int, string>
            {
                [413] = "What that address gave is larger than the station takes (25 MB).",
                [415] = "That address did not give up a sound in a format the station serves.",
                [422] = "That address did not give up a sound.",
            });
}

/// <summary>A new set, or a set renamed. The name is what a persona points at.</summary>
public sealed partial class PadSetDialogViewModel : PadDialogViewModel
{
    private readonly PadSet? _set;

    public PadSetDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station, PadSet? set)
        : base(actions, http, station)
    {
        _set = set;
        _key = set?.Key ?? string.Empty;
    }

    public override string Title => _set is null ? "Add a set" : $"Rename {_set.Key}";

    public override string AcceptLabel => _set is null ? "Add the set" : "Rename";

    public override bool CanAccept => Key.Trim().Length > 0 && Key.Trim() != _set?.Key;

    [ObservableProperty]
    private string _key;

    /// <summary>Renaming unpoints whoever pointed at the old name, which is said before it happens.</summary>
    public string? Warning => _set is { Personas.Count: > 0 } set
        ? $"Renaming unpoints {string.Join(", ", set.Personas)}: a persona names a set by its name."
        : null;

    public static string Help =>
        "A persona points at one of these by name. A folder in the pad library makes one automatically; these are for cutting that library a different way.";

    partial void OnKeyChanged(string value) => Revalidate();

    public override Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var body = new PadSetWrite { Key = Key.Trim(), Label = Key.Trim() };
        var taken = new Dictionary<int, string> { [409] = $"There is already a set called {body.Key}." };

        return _set is null
            ? WriteAsync((sdk, token) => sdk.Render.CreatePadSetAsync(body, token), cancellationToken, taken)
            : WriteAsync((sdk, token) => sdk.Render.UpdatePadSetAsync(_set.Id, body with { Position = _set.Position }, token), cancellationToken, taken);
    }
}
