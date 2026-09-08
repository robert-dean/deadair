using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One record in the library.</summary>
public sealed record TrackRowViewModel(
    Guid Id,
    string Title,
    string Artists,
    string? Album,
    string Length,
    string? Year,
    Uri? ArtworkUrl)
{
    /// <summary>The square drawn until, or instead of, a cover.</summary>
    public string Initial => Title.Length == 0 ? "?" : char.ToUpperInvariant(Title[0]).ToString();
}

/// <summary>One act.</summary>
public sealed record ArtistRowViewModel(Guid Id, string Name);

/// <summary>One release.</summary>
public sealed record AlbumRowViewModel(Guid Id, string Name, string ArtistName, Uri? ArtworkUrl)
{
    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();
}

/// <summary>A playlist the station can be put on air from.</summary>
public sealed record PlaylistRowViewModel(string PluginId, string Id, string Name, string Source, Uri? ArtworkUrl)
{
    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();
}

/// <summary>A published chart the station can be put on air from.</summary>
public sealed record ChartRowViewModel(string Id, string Name, string Source)
{
    /// <summary>A chart is a list the station builds, so there is no cover: the square is a letter.</summary>
    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();
}

/// <summary>One story the station could talk about.</summary>
public sealed record StoryRowViewModel(string Feed, string Title, string When);

/// <summary>Which part of the library is showing.</summary>
public enum LibraryTab
{
    Tracks,
    Artists,
    Albums,
    Playlists,
    Charts,
    News,
}

/// <summary>
/// The records the station can draw on.
/// </summary>
/// <remarks>
/// Read on demand rather than polled. A catalog does not change while somebody is looking at it, and
/// a station that rate-limits at a hundred requests per five seconds should not be asked for a page
/// of records every two.
/// </remarks>
public sealed partial class LibraryViewModel(OperatorActions actions, HttpClient http)
    : ObservableObject
{
    private const long PageSize = 50;

    private StationUrl _station;

    public ObservableCollection<TrackRowViewModel> Tracks { get; } = [];

    public ObservableCollection<ArtistRowViewModel> Artists { get; } = [];

    public ObservableCollection<AlbumRowViewModel> Albums { get; } = [];

    public ObservableCollection<PlaylistRowViewModel> Playlists { get; } = [];

    public ObservableCollection<ChartRowViewModel> Charts { get; } = [];

    public ObservableCollection<StoryRowViewModel> Stories { get; } = [];

    [ObservableProperty]
    private LibraryTab _tab = LibraryTab.Tracks;

    [ObservableProperty]
    private string? _notice;

    public bool IsTracks => Tab == LibraryTab.Tracks;

    public bool IsArtists => Tab == LibraryTab.Artists;

    public bool IsAlbums => Tab == LibraryTab.Albums;

    public bool IsPlaylists => Tab == LibraryTab.Playlists;

    public bool IsCharts => Tab == LibraryTab.Charts;

    public bool IsNews => Tab == LibraryTab.News;

    /// <summary>Paging belongs to the records; the other tabs answer whole.</summary>
    public bool ShowsPaging => IsTracks;

    [ObservableProperty]
    private string _search = string.Empty;

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private long _page;

    [ObservableProperty]
    private long _total;

    [ObservableProperty]
    private string _summary = string.Empty;

    public bool CanGoBack => Page > 0;

    public bool CanGoForward => (Page + 1) * PageSize < Total;

    public void Attach(StationUrl station) => _station = station;

    partial void OnTabChanged(LibraryTab value)
    {
        OnPropertyChanged(nameof(IsTracks));
        OnPropertyChanged(nameof(IsArtists));
        OnPropertyChanged(nameof(IsAlbums));
        OnPropertyChanged(nameof(IsPlaylists));
        OnPropertyChanged(nameof(IsCharts));
        OnPropertyChanged(nameof(IsNews));
        OnPropertyChanged(nameof(ShowsPaging));

        // Fetched the first time a tab is opened and not again. None of these change while somebody
        // is looking at them, and the station rate-limits.
        _ = value switch
        {
            LibraryTab.Artists when Artists.Count == 0 => LoadArtistsAsync(CancellationToken.None),
            LibraryTab.Albums when Albums.Count == 0 => LoadAlbumsAsync(CancellationToken.None),
            LibraryTab.Playlists when Playlists.Count == 0 => LoadPlaylistsAsync(CancellationToken.None),
            LibraryTab.Charts when Charts.Count == 0 => LoadChartsAsync(CancellationToken.None),
            LibraryTab.News when Stories.Count == 0 => LoadNewsAsync(CancellationToken.None),
            _ => Task.CompletedTask,
        };
    }

    [RelayCommand]
    private void ShowTab(string tab)
    {
        if (Enum.TryParse<LibraryTab>(tab, out var parsed))
        {
            Tab = parsed;
        }
    }

    private async Task LoadArtistsAsync(CancellationToken cancellationToken)
    {
        var page = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.ListArtistsAsync(
                    new CatalogQueryInput { PageSize = 200, SortBy = CatalogSort.Name, Sort = PaginationSort.Asc },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return;
        }

        Artists.Clear();
        foreach (var artist in page.Data)
        {
            Artists.Add(new ArtistRowViewModel(artist.Id, artist.Name));
        }
    }

    private async Task LoadAlbumsAsync(CancellationToken cancellationToken)
    {
        var page = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.ListAlbumsAsync(
                    new CatalogQueryInput { PageSize = 200, SortBy = CatalogSort.Name, Sort = PaginationSort.Asc },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return;
        }

        Albums.Clear();
        foreach (var album in page.Data)
        {
            Albums.Add(new AlbumRowViewModel(album.Id, album.Name, album.ArtistName, _station.ArtUrl(album.ImageUrl)));
        }
    }

    private async Task LoadPlaylistsAsync(CancellationToken cancellationToken)
    {
        var page = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Playlists.ListImportablePlaylistsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return;
        }

        Playlists.Clear();
        foreach (var playlist in page.Playlists)
        {
            Playlists.Add(new PlaylistRowViewModel(
                playlist.PluginId, playlist.Id, playlist.Name, playlist.PluginName,
                _station.ArtUrl(playlist.ArtworkUrl)));
        }
    }

    private async Task LoadChartsAsync(CancellationToken cancellationToken)
    {
        var list = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Charts.ListChartsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (list is null)
        {
            return;
        }

        Charts.Clear();
        foreach (var chart in list.Charts)
        {
            Charts.Add(new ChartRowViewModel(chart.Id, chart.Name, chart.PluginId));
        }
    }

    private async Task LoadNewsAsync(CancellationToken cancellationToken)
    {
        var page = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.News.ReadNewsAsync(new NewsQuery { Limit = 40 }, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return;
        }

        Stories.Clear();
        foreach (var story in page.Stories)
        {
            // `publishedAt` is a STRING rather than a datetime, because a feed publishes whatever
            // precision it has. Parsed where it parses and shown as sent where it does not, rather
            // than invented.
            var when = DateTimeOffset.TryParse(
                story.PublishedAt,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal,
                out var published)
                ? published.ToLocalTime().ToString("dd MMM HH:mm", CultureInfo.InvariantCulture)
                : story.PublishedAt ?? string.Empty;

            Stories.Add(new StoryRowViewModel(story.FeedName, story.Title, when));
        }
    }

    /// <summary>
    /// Puts the station on air from a playlist.
    /// </summary>
    /// <remarks>
    /// This REPLACES the running order rather than adding to it, and what is on air finishes first.
    /// It is the single most consequential thing on this page, which is why it says so before doing
    /// it rather than afterwards.
    /// </remarks>
    [RelayCommand]
    private async Task PlayPlaylistAsync(PlaylistRowViewModel playlist)
    {
        ArgumentNullException.ThrowIfNull(playlist);

        var status = await actions.RunAsync(
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

    /// <remarks>
    /// A chart answers with the status BEFORE the changeover and does the work as a job, so there is
    /// nothing immediate to report beyond having asked.
    /// </remarks>
    [RelayCommand]
    private async Task PlayChartAsync(ChartRowViewModel chart)
    {
        ArgumentNullException.ThrowIfNull(chart);

        var status = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Playout.PlayAChartAsync(new PlayoutChartInput { ChartId = chart.Id }, token)
                    .ConfigureAwait(false);
            },
            new Dictionary<int, string> { [422] = "That chart could not be read." })
            .ConfigureAwait(true);

        if (status is not null)
        {
            Notice = $"Building a running order from {chart.Name}. It takes a moment.";
        }
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var page = await actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();
                    return await sdk.Catalog.ListTracksAsync(
                        new TrackQueryInput
                        {
                            Page = Page,
                            PageSize = PageSize,
                            Search = string.IsNullOrWhiteSpace(Search) ? null : Search.Trim(),
                            SortBy = TrackSort.Title,
                            Sort = PaginationSort.Asc,
                        },
                        token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (page is null)
            {
                return;
            }

            Total = page.Meta.Total;

            Tracks.Clear();
            foreach (var row in page.Data)
            {
                Tracks.Add(new TrackRowViewModel(
                    row.Id,
                    row.Title,
                    row.Artists,
                    row.AlbumName,
                    row.DurationMs is { } ms && ms > 0
                        ? TimeSpan.FromMilliseconds(ms).ToString(@"m\:ss", CultureInfo.InvariantCulture)
                        : "--:--",
                    row.Year?.ToString(CultureInfo.InvariantCulture),
                    _station.ArtUrl(row.AlbumImageUrl)));
            }

            var first = Total == 0 ? 0 : (Page * PageSize) + 1;
            var last = Math.Min((Page + 1) * PageSize, Total);
            Summary = Total == 0
                ? "Nothing in the catalog matches that."
                : $"{first}–{last} of {Total}";

            OnPropertyChanged(nameof(CanGoBack));
            OnPropertyChanged(nameof(CanGoForward));
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private async Task SearchTracksAsync(CancellationToken cancellationToken)
    {
        // A new search starts at the first page. Staying on page seven of the previous results is how
        // a search appears to return nothing.
        Page = 0;
        await LoadAsync(cancellationToken).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task NextPageAsync(CancellationToken cancellationToken)
    {
        if (!CanGoForward)
        {
            return;
        }

        Page++;
        await LoadAsync(cancellationToken).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task PreviousPageAsync(CancellationToken cancellationToken)
    {
        if (!CanGoBack)
        {
            return;
        }

        Page--;
        await LoadAsync(cancellationToken).ConfigureAwait(true);
    }

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = http,
    });
}
