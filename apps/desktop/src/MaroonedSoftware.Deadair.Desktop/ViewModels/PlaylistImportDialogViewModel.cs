using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>Where an import reads from.</summary>
public enum ImportFrom
{
    File,
    Paste,
    Link,
}

/// <summary>One record of an import's preview, and where it lands.</summary>
public sealed record ImportEntryViewModel(string Title, string Artists, bool InLibrary)
{
    public string LandsAs => InLibrary ? "In the library" : "To look up";
}

/// <summary>
/// Taking a playlist in as one of the station's own: from a file, a pasted list, a link, or a music
/// source's playlist.
/// </summary>
/// <remarks>
/// <para>
/// Two steps, as the web console has it: the source is read and previewed, which writes nothing, and
/// only then is Import offered, naming how many records it takes. Importing the same thing twice
/// makes two playlists, and a record the library does not hold keeps its place and is looked up
/// afterwards, which is why the preview says which is which.
/// </para>
/// <para>
/// The preview marks the dialog busy while it runs, so a refusal is said on the dialog rather than
/// behind it; the host does the same for the import itself.
/// </para>
/// </remarks>
public sealed partial class PlaylistImportDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly Func<DeadairSdk> _sdk;
    private readonly IFilePicker _picker;
    private readonly PlaylistProviderRef? _provider;
    private readonly Action<StationPlaylist> _imported;
    private PlaylistImportInput? _source;

    /// <param name="provider">A music source's playlist, when the dialog saves that one rather than asking for a source.</param>
    /// <param name="providerName">That playlist's name, which the new one starts with.</param>
    public PlaylistImportDialogViewModel(
        OperatorActions actions,
        Func<DeadairSdk> sdk,
        IFilePicker picker,
        Action<StationPlaylist> imported,
        PlaylistProviderRef? provider = null,
        string? providerName = null)
    {
        _actions = actions;
        _sdk = sdk;
        _picker = picker;
        _imported = imported;
        _provider = provider;

        if (provider is not null)
        {
            _name = providerName ?? string.Empty;
            Saving = $"Saving {providerName} as a playlist of the station's own.";
        }
    }

    public override string Title => _provider is null ? "Import a playlist" : "Save as a station playlist";

    public override string AcceptLabel => Entries.Count == 1 ? "Import 1 record" : $"Import {Entries.Count} records";

    public override bool CanAccept => Plan is not null && Entries.Count > 0;

    public string Intro { get; } =
        "It becomes a new playlist of the station's own: importing the same thing twice makes two. A record the library does not hold keeps its place, and the station looks it up at its music sources straight after the import.";

    /// <summary>Whether the dialog asks for a source; one saving a music source's playlist already has one.</summary>
    public bool AsksForSource => _provider is null;

    /// <summary>What the dialog is saving, when it was opened on a music source's playlist.</summary>
    public string? Saving { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsFile), nameof(IsPaste), nameof(IsLink))]
    private ImportFrom _from = ImportFrom.File;

    public bool IsFile => From == ImportFrom.File;

    public bool IsPaste => From == ImportFrom.Paste;

    public bool IsLink => From == ImportFrom.Link;

    [ObservableProperty]
    private string? _fileName;

    [ObservableProperty]
    private string _pasted = string.Empty;

    [ObservableProperty]
    private string _link = string.Empty;

    [ObservableProperty]
    private string _name = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPlan))]
    private string? _plan;

    public bool HasPlan => Plan is not null;

    public ObservableCollection<string> Notices { get; } = [];

    public ObservableCollection<ImportEntryViewModel> Entries { get; } = [];

    partial void OnFromChanged(ImportFrom value) => Forget();

    /// <summary>Opening on a music source's playlist reads it straight away: there is nothing to choose.</summary>
    public Task StartAsync() => _provider is null
        ? Task.CompletedTask
        : PreviewAsync(new PlaylistImportInput { ProviderPlaylist = _provider });

    [RelayCommand]
    private void Show(string from)
    {
        if (Enum.TryParse<ImportFrom>(from, out var parsed))
        {
            From = parsed;
        }
    }

    [RelayCommand]
    private async Task ChooseFileAsync()
    {
        var file = await _picker.OpenAsync(
            "A playlist to import",
            ["*.json", "*.m3u", "*.m3u8", "*.csv", "*.tsv", "*.txt"]).ConfigureAwait(true);

        if (file is null)
        {
            return;
        }

        Forget();
        FileName = file.Name;
        var source = PlaylistRules.FromFile(file.Name, file.Data);
        if (source.Input is { } input)
        {
            await PreviewAsync(input).ConfigureAwait(true);
        }
        else
        {
            Problem = source.Problem;
        }
    }

    [RelayCommand]
    private Task PreviewPastedAsync() =>
        string.IsNullOrWhiteSpace(Pasted) ? Task.CompletedTask : PreviewAsync(new PlaylistImportInput { Text = Pasted });

    [RelayCommand]
    private Task PreviewLinkAsync() =>
        string.IsNullOrWhiteSpace(Link) ? Task.CompletedTask : PreviewAsync(new PlaylistImportInput { Url = Link.Trim() });

    /// <summary>Reads a source and shows what importing it would do. Writes nothing.</summary>
    public async Task PreviewAsync(PlaylistImportInput input)
    {
        ArgumentNullException.ThrowIfNull(input);

        Problem = null;
        Busy = true;
        try
        {
            var plan = await _actions.RunAsync(
                async token =>
                {
                    using var sdk = _sdk();
                    return await sdk.StationPlaylists.PreviewPlaylistImportAsync(input, token).ConfigureAwait(false);
                },
                new Dictionary<int, string>
                {
                    [400] = "That could not be read. It is not a playlist this station recognises.",
                    [422] = "That could not be read. It is not a playlist this station recognises.",
                }).ConfigureAwait(true);

            if (plan is not null)
            {
                Present(input, plan);
            }
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Draws a preview. Public so a frame can be posed from one.</summary>
    public void Present(PlaylistImportInput input, PlaylistImportPlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);

        _source = input;
        if (_provider is null || string.IsNullOrWhiteSpace(Name))
        {
            Name = plan.Name;
        }

        Notices.Clear();
        foreach (var notice in plan.Notices)
        {
            Notices.Add(notice);
        }

        Entries.Clear();
        foreach (var entry in plan.Entries)
        {
            Entries.Add(new ImportEntryViewModel(entry.Title, string.Join(", ", entry.Artists), entry.Outcome == PlaylistImportEntryOutcome.Matched));
        }

        Plan = PlaylistRules.Plan(plan);
        OnPropertyChanged(nameof(AcceptLabel));
        Revalidate();
    }

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        if (_source is not { } source)
        {
            return false;
        }

        var name = Name.Trim();
        var result = await _actions.RunAsync(
            async token =>
            {
                using var sdk = _sdk();
                return await sdk.StationPlaylists.ImportPlaylistAsync(
                    name.Length == 0 ? source : source with { Name = name },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (result is null)
        {
            return false;
        }

        _imported(result.Playlist);
        return true;
    }

    /// <summary>A new source starts a new preview, so the last one's import cannot be pressed by mistake.</summary>
    private void Forget()
    {
        _source = null;
        Plan = null;
        Problem = null;
        Notices.Clear();
        Entries.Clear();
        OnPropertyChanged(nameof(AcceptLabel));
        Revalidate();
    }
}
