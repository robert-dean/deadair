using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>A playlist the station can be put on air from.</summary>
public sealed record PlaylistRowViewModel(string PluginId, string Id, string Name, string Source, Uri? ArtworkUrl)
{
    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();
}

/// <summary>
/// The playlists the station's plugins can read, and putting one on air.
/// </summary>
public sealed partial class PlaylistsViewModel(OperatorActions actions, HttpClient http, IDialogs dialogs)
    : LibraryTabViewModel(actions, http)
{
    public ObservableCollection<PlaylistRowViewModel> Playlists { get; } = [];

    protected override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Playlists.ListImportablePlaylistsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return false;
        }

        Playlists.Clear();
        foreach (var playlist in page.Playlists)
        {
            Playlists.Add(new PlaylistRowViewModel(
                playlist.PluginId, playlist.Id, playlist.Name, playlist.PluginName,
                Station.ArtUrl(playlist.ArtworkUrl)));
        }

        return true;
    }

    /// <summary>
    /// Puts the station on air from a playlist.
    /// </summary>
    /// <remarks>
    /// This REPLACES the running order rather than adding to it, and what is on air finishes first.
    /// It is the single most consequential thing on this page, which is why it asks first and says
    /// so again afterwards.
    /// </remarks>
    [RelayCommand]
    private async Task PlayAsync(PlaylistRowViewModel playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);

        if (!await dialogs.ConfirmAsync(
                $"Put {playlist.Name} on air?",
                "It replaces the running order. What is on air now finishes first.",
                "Put on air").ConfigureAwait(true))
        {
            return;
        }

        var status = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Playout.PlayAPlaylistAsync(
                    new PlayoutPlaylistInput { PluginId = playlist.PluginId, PlaylistId = playlist.Id },
                    token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [422] = "There is nothing on that playlist the station can play." })
            .ConfigureAwait(true);

        if (status is not null)
        {
            Notice = $"{playlist.Name} is the running order now.";
        }
    }

    public override void Reset()
    {
        base.Reset();
        Playlists.Clear();
    }
}
