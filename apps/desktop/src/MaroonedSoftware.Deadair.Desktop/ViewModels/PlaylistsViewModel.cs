using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>A music source's playlist.</summary>
public sealed class PlaylistRowViewModel(CatalogPlaylist playlist, Uri? artworkUrl, IReadOnlyList<MenuChoiceViewModel> menu)
{
    public CatalogPlaylist Playlist { get; } = playlist;

    public string PluginId => Playlist.PluginId;

    public string Id => Playlist.Id;

    public string Name => Playlist.Name;

    public string Source => Playlist.PluginName;

    public Uri? ArtworkUrl { get; } = artworkUrl;

    /// <summary>A source that will not hand the tracks over cannot air them either, so this gates both.</summary>
    public bool CanRead { get; } = PlaylistRules.CanReadTracks(playlist);

    /// <summary>The line under the name: whose, how long, or why nothing can be done with it.</summary>
    public string Line { get; } = PlaylistRules.CanReadTracks(playlist)
        ? playlist.TrackCount is { } count
            ? $"{playlist.PluginName} · {(count == 1 ? "1 track" : $"{count:N0} tracks")}"
            : playlist.PluginName
        : $"{playlist.PluginName} won't share this playlist's tracks.";

    public string Description { get; } = playlist.Description ?? "No description.";

    public IReadOnlyList<MenuChoiceViewModel> Menu { get; } = menu;

    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();
}

/// <summary>One of the station's own playlists.</summary>
public sealed class StationPlaylistRowViewModel(StationPlaylist playlist, string? origin)
{
    public Guid Id { get; } = Guid.TryParse(playlist.Id, out var id) ? id : Guid.Empty;

    public string Name { get; } = playlist.Name;

    public string Line { get; } = origin is null
        ? PlaylistRules.Holding(playlist.TrackCount, playlist.ResolvedCount)
        : $"From {origin} · {PlaylistRules.Holding(playlist.TrackCount, playlist.ResolvedCount)}";

    public string? Prompt { get; } = playlist.Prompt.Length == 0 ? null : playlist.Prompt;

    /// <summary>A playlist of nothing but records the library does not hold is refused, so it is not offered.</summary>
    public bool CanAir { get; } = playlist.ResolvedCount > 0;

    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();
}

/// <summary>
/// The station's own playlists, the music sources' playlists, and putting any of them on air.
/// </summary>
/// <remarks>
/// <para>
/// The station's own come first, since they are the ones it holds rather than borrows. A source's
/// playlists are split three ways: the ones somebody put there are shown, and the ones the source
/// made on its own and the ones an operator hid are folded away, because on a source like YouTube
/// Music the made-for-you mixes outnumber the chosen ones and bury them.
/// </para>
/// <para>
/// Hiding deletes nothing: it leaves the playlist out of every picker and the library sync. A source
/// that could not be listed is named with its reason rather than leaving the list quietly short.
/// </para>
/// </remarks>
public sealed partial class PlaylistsViewModel(
    OperatorActions actions,
    HttpClient http,
    IDialogs dialogs,
    NavigationViewModel navigation,
    IFilePicker picker) : LibraryTabViewModel(actions, http)
{
    private List<CatalogPlaylist> _all = [];

    public ObservableCollection<StationPlaylistRowViewModel> Own { get; } = [];

    public ObservableCollection<PlaylistRowViewModel> Playlists { get; } = [];

    public ObservableCollection<PlaylistRowViewModel> MadeByProvider { get; } = [];

    public ObservableCollection<PlaylistRowViewModel> Hidden { get; } = [];

    /// <summary>Each source that could not be listed, and why.</summary>
    public ObservableCollection<string> SourceErrors { get; } = [];

    [ObservableProperty]
    private string? _summary;

    [ObservableProperty]
    private string? _empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(MadeByToggle))]
    private bool _showMadeBy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HiddenToggle))]
    private bool _showHidden;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(MadeByToggle), nameof(HasMadeBy))]
    private string _makers = string.Empty;

    public bool HasOwn => Own.Count > 0;

    public bool HasMadeBy => MadeByProvider.Count > 0;

    public bool HasHidden => Hidden.Count > 0;

    public string MadeByToggle => ShowMadeBy
        ? $"Collapse the {MadeByProvider.Count} made by {Makers}"
        : $"Show {MadeByProvider.Count} made by {Makers}";

    public string HiddenToggle => ShowHidden ? $"Collapse the {Hidden.Count} hidden" : $"Show {Hidden.Count} hidden";

    [RelayCommand]
    private void ToggleMadeBy() => ShowMadeBy = !ShowMadeBy;

    [RelayCommand]
    private void ToggleHidden() => ShowHidden = !ShowHidden;

    protected override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        var sources = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Playlists.ListImportablePlaylistsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var own = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.StationPlaylists.ListStationPlaylistsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (sources is null && own is null)
        {
            return false;
        }

        Present(sources, own);
        return true;
    }

    /// <summary>Draws what the station answered with. Public so a frame can be posed from it.</summary>
    public void Present(CatalogPlaylistPage? sources, StationPlaylistList? own)
    {
        if (sources is not null)
        {
            _all = [.. sources.Playlists];
            SourceErrors.Clear();
            foreach (var error in sources.Errors)
            {
                SourceErrors.Add($"{error.PluginName}: {error.Message}");
            }
        }

        if (own is not null)
        {
            // A station playlist names the plugin it was cloned from by id; the sources' own list is
            // the one place this page has that id's name.
            var names = _all.GroupBy(each => each.PluginId).ToDictionary(group => group.Key, group => group.First().PluginName, StringComparer.Ordinal);
            Own.Clear();
            foreach (var playlist in own.Playlists)
            {
                var origin = playlist.OriginPluginId is { } plugin ? names.GetValueOrDefault(plugin, plugin) : null;
                Own.Add(new StationPlaylistRowViewModel(playlist, origin));
            }

            OnPropertyChanged(nameof(HasOwn));
        }

        Regroup();
    }

    private void Regroup()
    {
        var groups = PlaylistRules.Group(_all);
        Fill(Playlists, groups.Chosen);
        Fill(MadeByProvider, groups.MadeByProvider);
        Fill(Hidden, groups.Hidden);
        Makers = PlaylistRules.Makers(groups.MadeByProvider);
        OnPropertyChanged(nameof(HasMadeBy));
        OnPropertyChanged(nameof(HasHidden));
        OnPropertyChanged(nameof(HiddenToggle));

        Summary = PlaylistRules.Availability(groups.Chosen.Count, Own.Count);

        // Never both stories at once: telling an operator to enable a plugin under a line saying their
        // enabled plugin failed sends them to the wrong screen.
        Empty = _all.Count > 0
            ? null
            : SourceErrors.Count > 0
                ? "The plugins that could offer playlists are listed above, with why each one could not be."
                : "No playlists are available. Enable a plugin with the catalog capability to see its playlists here.";
    }

    private void Fill(ObservableCollection<PlaylistRowViewModel> rows, IEnumerable<CatalogPlaylist> playlists)
    {
        rows.Clear();
        foreach (var playlist in playlists)
        {
            rows.Add(new PlaylistRowViewModel(playlist, Station.ArtUrl(playlist.ArtworkUrl), Menu(playlist)));
        }
    }

    private List<MenuChoiceViewModel> Menu(CatalogPlaylist playlist)
    {
        var menu = new List<MenuChoiceViewModel>();
        var hidden = playlist.Hidden == true;

        if (!hidden && PlaylistRules.CanReadTracks(playlist))
        {
            menu.Add(new("Refresh this playlist", new AsyncRelayCommand(() => RefreshOneAsync(playlist))));
        }

        menu.Add(new(
            hidden ? "Show again (offered in the pickers and synced again)" : "Hide (left out of every picker and the sync; nothing is deleted)",
            new AsyncRelayCommand(() => SetHiddenAsync(playlist, !hidden))));
        return menu;
    }

    private async Task RefreshOneAsync(CatalogPlaylist playlist)
    {
        if (await Actions.DoAsync(async token =>
            {
                using var sdk = Sdk();
                await sdk.Playlists.RefreshPlaylistAsync(playlist.PluginId, playlist.Id, token).ConfigureAwait(false);
            }).ConfigureAwait(true))
        {
            Notice = $"The station is reading {playlist.Name} again.";
        }
    }

    private async Task SetHiddenAsync(CatalogPlaylist playlist, bool hide)
    {
        var done = await Actions.DoAsync(async token =>
        {
            using var sdk = Sdk();
            if (hide)
            {
                await sdk.Playlists.HidePlaylistAsync(playlist.PluginId, playlist.Id, token).ConfigureAwait(false);
            }
            else
            {
                await sdk.Playlists.ShowPlaylistAsync(playlist.PluginId, playlist.Id, token).ConfigureAwait(false);
            }
        }).ConfigureAwait(true);

        if (!done)
        {
            return;
        }

        var index = _all.FindIndex(each => each.PluginId == playlist.PluginId && each.Id == playlist.Id);
        if (index >= 0)
        {
            _all[index] = _all[index] with { Hidden = hide };
        }

        Regroup();
    }

    /// <summary>Asks every source for its playlists again. The station does it as a job, so this only asks.</summary>
    [RelayCommand]
    private async Task RefreshAllAsync()
    {
        if (await Actions.DoAsync(async token =>
            {
                using var sdk = Sdk();
                await sdk.Playlists.RefreshPlaylistsAsync(token).ConfigureAwait(false);
            }).ConfigureAwait(true))
        {
            Notice = "The station is reading every playlist again. New records reach the library in a few minutes, and the activity feed says when it is done.";
        }
    }

    [RelayCommand]
    private async Task ImportAsync()
    {
        var dialog = new PlaylistImportDialogViewModel(Actions, Sdk, picker, Imported);
        await dialogs.ShowAsync(dialog).ConfigureAwait(true);
    }

    /// <summary>Saves a music source's playlist as one of the station's own, from its tracks page.</summary>
    public async Task SaveAsStationAsync(string pluginId, string playlistId, string name)
    {
        var dialog = new PlaylistImportDialogViewModel(
            Actions,
            Sdk,
            picker,
            Imported,
            new PlaylistProviderRef { PluginId = pluginId, PlaylistId = playlistId },
            name);
        var shown = dialogs.ShowAsync(dialog);
        await dialog.StartAsync().ConfigureAwait(true);
        await shown.ConfigureAwait(true);
    }

    /// <summary>A new playlist of the station's own is opened, and this tab reads again behind it.</summary>
    private void Imported(StationPlaylist playlist)
    {
        Reread();
        if (Guid.TryParse(playlist.Id, out var id))
        {
            navigation.Push(new Navigation.Destination.StationPlaylistDetail(id, playlist.Name));
        }
    }

    [RelayCommand]
    private void OpenTracks(PlaylistRowViewModel playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);
        navigation.Push(new Navigation.Destination.PlaylistTracks(playlist.PluginId, playlist.Id, playlist.Name, playlist.Source));
    }

    [RelayCommand]
    private void OpenOwn(StationPlaylistRowViewModel playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);
        navigation.Push(new Navigation.Destination.StationPlaylistDetail(playlist.Id, playlist.Name));
    }

    /// <summary>
    /// Puts the station on air from a music source's playlist.
    /// </summary>
    /// <remarks>
    /// This REPLACES the running order rather than adding to it, and what is on air finishes first.
    /// It is the single most consequential thing on this page, which is why it asks first and says
    /// so again afterwards.
    /// </remarks>
    [RelayCommand]
    private Task<bool> PlayAsync(PlaylistRowViewModel playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);
        return PlaySourceAsync(playlist.PluginId, playlist.Id, playlist.Name);
    }

    [RelayCommand]
    private Task<bool> PlayOwnAsync(StationPlaylistRowViewModel playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);
        return PlayStationAsync(playlist.Id, playlist.Name);
    }

    /// <summary>The Put on air a source playlist's own page offers, so the two cannot behave differently.</summary>
    public async Task<bool> PlaySourceAsync(string pluginId, string playlistId, string name)
    {
        if (!await AskToAirAsync(name).ConfigureAwait(true))
        {
            return false;
        }

        var status = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Playout.PlayAPlaylistAsync(new PlayoutPlaylistInput { PluginId = pluginId, PlaylistId = playlistId }, token)
                    .ConfigureAwait(false);
            },
            new Dictionary<int, string> { [422] = "There is nothing on that playlist the station can play." })
            .ConfigureAwait(true);

        if (status is null)
        {
            return false;
        }

        Notice = $"{name} is the running order now.";
        return true;
    }

    /// <summary>The Put on air a station playlist's own page offers.</summary>
    public async Task<bool> PlayStationAsync(Guid id, string name)
    {
        if (!await AskToAirAsync(name).ConfigureAwait(true))
        {
            return false;
        }

        var status = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Playout.PlayAStationPlaylistAsync(new PlayoutStationPlaylistInput { StationPlaylistId = id }, token)
                    .ConfigureAwait(false);
            },
            new Dictionary<int, string> { [422] = "Nothing on that playlist is in the library yet, so there is nothing to play." })
            .ConfigureAwait(true);

        if (status is null)
        {
            return false;
        }

        Notice = $"{name} is the running order now.";
        return true;
    }

    private Task<bool> AskToAirAsync(string name) => dialogs.ConfirmAsync(
        $"Put {name} on air?",
        "It replaces the running order. What is on air now finishes first.",
        "Put on air");

    /// <summary>
    /// Reads the tab again behind whatever page is showing, after something changed what the station
    /// holds. Going back to the Library does not re-open a tab, so waiting for the next visit would
    /// show the old list.
    /// </summary>
    public void Reread() => _ = RefreshCommand.ExecuteAsync(null);

    public override void Reset()
    {
        base.Reset();
        _all = [];
        Own.Clear();
        Playlists.Clear();
        MadeByProvider.Clear();
        Hidden.Clear();
        SourceErrors.Clear();
        Summary = null;
        Empty = null;
        ShowMadeBy = false;
        ShowHidden = false;
        OnPropertyChanged(nameof(HasOwn));
        OnPropertyChanged(nameof(HasMadeBy));
        OnPropertyChanged(nameof(HasHidden));
    }
}
