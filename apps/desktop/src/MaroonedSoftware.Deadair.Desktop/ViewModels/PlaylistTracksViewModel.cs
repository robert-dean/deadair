using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// A music source's playlist, read before it is put on air or kept as one of the station's own.
/// </summary>
/// <remarks>
/// Keeping it makes a clone the station holds, free to differ from the source's list afterwards,
/// which is why it goes through the same import (and the same preview) as a file does.
/// </remarks>
public sealed partial class PlaylistTracksViewModel(
    CatalogPageContext context,
    PlaylistsViewModel playlists,
    string pluginId,
    string playlistId,
    string name,
    string source) : ObservableObject, IPlaylistEntries
{
    public ObservableCollection<PlaylistEntryViewModel> Entries { get; } = [];

    public string Name { get; } = name;

    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();

    [ObservableProperty]
    private string _line = $"From {source}";

    [ObservableProperty]
    private string? _empty;

    [ObservableProperty]
    private bool _hasTracks;

    [ObservableProperty]
    private string? _notice;

    [ObservableProperty]
    private string? _problem;

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        var tracks = await context.Actions.RunAsync(
            async token =>
            {
                using var sdk = context.Sdk();
                return await sdk.Playlists.GetPlaylistTracksAsync(pluginId, playlistId, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (tracks is null)
        {
            Problem = "This playlist could not be read.";
            return;
        }

        Present(tracks);
    }

    /// <summary>Draws the tracks the source answered with. Public so a frame can be posed from them.</summary>
    public void Present(CatalogPlaylistTracks tracks)
    {
        ArgumentNullException.ThrowIfNull(tracks);

        Problem = null;
        Entries.Clear();
        var position = 0;
        foreach (var track in tracks.Tracks)
        {
            position++;
            Entries.Add(new PlaylistEntryViewModel(
                position.ToString(CultureInfo.InvariantCulture),
                track.Title,
                string.Join(", ", track.Artists),
                track.Album,
                track.DurationMs,
                PlaylistEntryViewModel.Parse(track.TrackId)));
        }

        Line = $"From {source} · {(Entries.Count == 1 ? "1 track" : $"{Entries.Count} tracks")}";
        HasTracks = Entries.Count > 0;
        Empty = HasTracks ? null : "This playlist has no tracks.";
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
        if (await playlists.PlaySourceAsync(pluginId, playlistId, Name).ConfigureAwait(true))
        {
            Notice = $"{Name} is the running order now. What is on air finishes first.";
        }
    }

    [RelayCommand]
    private Task SaveAsStationAsync() => playlists.SaveAsStationAsync(pluginId, playlistId, Name);
}
