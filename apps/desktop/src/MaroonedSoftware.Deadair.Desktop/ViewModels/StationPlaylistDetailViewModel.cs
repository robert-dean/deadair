using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One record a playlist names, held by the library or waiting to be looked up.</summary>
public sealed class PlaylistEntryViewModel(
    string position,
    string title,
    string artists,
    string? album,
    long? durationMs,
    Guid? trackId)
{
    public string Position { get; } = position;

    public string Title { get; } = title;

    public string Artists { get; } = artists;

    public string? Album { get; } = album;

    public string Length { get; } = CatalogPaging.Length(durationMs);

    public Guid? TrackId { get; } = trackId;

    /// <summary>A record the library does not hold keeps its place, and is drawn as waiting rather than as a link to nothing.</summary>
    public bool Held => TrackId is not null;

    public static Guid? Parse(string? id) => Guid.TryParse(id, out var parsed) ? parsed : null;
}

/// <summary>A page listing the records a playlist names, as both kinds of playlist page are.</summary>
public interface IPlaylistEntries
{
    ObservableCollection<PlaylistEntryViewModel> Entries { get; }

    IRelayCommand<PlaylistEntryViewModel> OpenTrackCommand { get; }
}

/// <summary>Renaming one of the station's playlists, and saying what it is for.</summary>
public sealed partial class RenameStationPlaylistDialogViewModel(
    OperatorActions actions,
    Func<DeadairSdk> sdk,
    Guid id,
    string name,
    string prompt,
    Action<StationPlaylist> saved) : DialogViewModel
{
    public override string Title => "Rename playlist";

    public override bool CanAccept => Name.Trim().Length > 0;

    [ObservableProperty]
    private string _name = name;

    /// <summary>What it is for, in the operator's own words. Optional.</summary>
    [ObservableProperty]
    private string _prompt = prompt;

    partial void OnNameChanged(string value) => Revalidate();

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var playlist = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.StationPlaylists.UpdateStationPlaylistAsync(
                    id,
                    new StationPlaylistUpdate { Name = Name.Trim(), Prompt = Prompt.Trim() },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (playlist is null)
        {
            return false;
        }

        saved(playlist);
        return true;
    }
}

/// <summary>
/// One of the station's own playlists: its records, and what can be done with it.
/// </summary>
/// <remarks>
/// Put on air is offered only while something on it can air, because a playlist of nothing but
/// records the library does not hold is refused; looking up the missing ones is offered only while
/// some are missing. Deleting it takes the playlist and leaves the records it named in the library.
/// </remarks>
public sealed partial class StationPlaylistDetailViewModel(
    CatalogPageContext context,
    IFilePicker picker,
    PlaylistsViewModel playlists,
    Guid id,
    string name) : ObservableObject, IPlaylistEntries
{
    public ObservableCollection<PlaylistEntryViewModel> Entries { get; } = [];

    [ObservableProperty]
    private string _name = name;

    [ObservableProperty]
    private string? _line;

    [ObservableProperty]
    private string? _prompt;

    [ObservableProperty]
    private string? _empty;

    [ObservableProperty]
    private bool _canAir;

    [ObservableProperty]
    private bool _canFill;

    [ObservableProperty]
    private bool _read;

    [ObservableProperty]
    private string? _notice;

    [ObservableProperty]
    private string? _problem;

    private string _promptText = string.Empty;

    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();

    partial void OnNameChanged(string value) => OnPropertyChanged(nameof(Initial));

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        var detail = await context.Actions.RunAsync(
            async token =>
            {
                using var sdk = context.Sdk();
                return await sdk.StationPlaylists.GetStationPlaylistAsync(id, token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [404] = "That playlist is not there any more. It may have been deleted." },
            cancellationToken).ConfigureAwait(true);

        if (detail is null)
        {
            Problem = "This playlist could not be read.";
            return;
        }

        Present(detail, origin: null);
    }

    /// <summary>Draws the playlist the station answered with. Public so a frame can be posed from one.</summary>
    public void Present(StationPlaylistDetail detail, string? origin)
    {
        ArgumentNullException.ThrowIfNull(detail);

        Problem = null;
        Name = detail.Name;
        _promptText = detail.Prompt;
        Prompt = detail.Prompt.Length == 0 ? null : detail.Prompt;
        var holding = PlaylistRules.Holding(detail.TrackCount, detail.ResolvedCount);
        var from = origin ?? detail.OriginPluginId;
        Line = from is null ? $"The station's own · {holding}" : $"The station's own, cloned from {from} · {holding}";
        CanAir = detail.ResolvedCount > 0;
        CanFill = detail.ResolvedCount < detail.TrackCount;

        Entries.Clear();
        foreach (var track in detail.Tracks.OrderBy(each => each.Position))
        {
            Entries.Add(new PlaylistEntryViewModel(
                (track.Position + 1).ToString(CultureInfo.InvariantCulture),
                track.Title,
                string.Join(", ", track.Artists),
                track.Album,
                track.DurationMs,
                PlaylistEntryViewModel.Parse(track.TrackId)));
        }

        Empty = Entries.Count == 0 ? "This playlist names no records." : null;
        Read = true;
    }

    [RelayCommand]
    private void OpenTrack(PlaylistEntryViewModel entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (entry.TrackId is { } track)
        {
            context.Navigation.Push(new Navigation.Destination.TrackDetail(track, entry.Title));
        }
    }

    [RelayCommand]
    private async Task PlayAsync()
    {
        if (await playlists.PlayStationAsync(id, Name).ConfigureAwait(true))
        {
            Notice = $"{Name} is the running order now. What is on air finishes first.";
        }
    }

    /// <summary>Asks the station to look up the records it does not hold. It does it as a job.</summary>
    [RelayCommand]
    private async Task FillAsync()
    {
        if (await context.Actions.DoAsync(async token =>
            {
                using var sdk = context.Sdk();
                await sdk.StationPlaylists.FillStationPlaylistAsync(id, token).ConfigureAwait(false);
            }).ConfigureAwait(true))
        {
            Notice = $"The station is looking up the records missing from {Name}. The activity feed says how many it found.";
        }
    }

    /// <summary>Saves the playlist as a file another station can import, where somebody chooses.</summary>
    [RelayCommand]
    private async Task ExportAsync()
    {
        var export = await context.Actions.RunAsync(
            async token =>
            {
                using var sdk = context.Sdk();
                return await sdk.StationPlaylists.ExportStationPlaylistAsync(id, token).ConfigureAwait(false);
            }).ConfigureAwait(true);

        if (export is null)
        {
            return;
        }

        if (await picker.SaveAsync(
                "Export the playlist",
                PlaylistRules.ExportName(export.Headers.ContentDisposition, Name),
                PlaylistRules.ExportBytes(export.Data)).ConfigureAwait(true))
        {
            Notice = $"Saved {Name} as a playlist file.";
        }
    }

    [RelayCommand]
    private Task<bool> RenameAsync() => context.Dialogs.ShowAsync(new RenameStationPlaylistDialogViewModel(
        context.Actions,
        context.Sdk,
        id,
        Name,
        _promptText,
        saved =>
        {
            Name = saved.Name;
            _promptText = saved.Prompt;
            Prompt = saved.Prompt.Length == 0 ? null : saved.Prompt;
            playlists.Reread();
        }));

    [RelayCommand]
    private async Task DeleteAsync()
    {
        if (!await context.Dialogs.ConfirmAsync(
                $"Delete {Name}?",
                "The playlist goes. The records it named stay in the library.",
                "Delete").ConfigureAwait(true))
        {
            return;
        }

        if (await context.Actions.DoAsync(async token =>
            {
                using var sdk = context.Sdk();
                await sdk.StationPlaylists.DeleteStationPlaylistAsync(id, token).ConfigureAwait(false);
            }).ConfigureAwait(true))
        {
            playlists.Reread();
            context.Navigation.Back();
        }
    }
}
