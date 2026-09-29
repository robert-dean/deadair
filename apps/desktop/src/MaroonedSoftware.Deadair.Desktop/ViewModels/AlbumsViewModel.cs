using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One release.</summary>
public sealed class AlbumRowViewModel(Guid id, string name, string artistName, long? year, long tracks, Uri? artworkUrl, RatingViewModel rating)
{
    public Guid Id { get; } = id;

    public string Name { get; } = name;

    public string ArtistName { get; } = artistName;

    public string? Year { get; } = year?.ToString(CultureInfo.InvariantCulture);

    public Uri? ArtworkUrl { get; } = artworkUrl;

    /// <summary>How many of its records the station has.</summary>
    public string Holding { get; } = ArtistRowViewModel.Plural(tracks, "record");

    public RatingViewModel Rating { get; } = rating;

    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();
}

/// <summary>
/// Every release the station has.
/// </summary>
/// <remarks>
/// The web console has no list of releases, only a release's own page reached from a record or an
/// act. This app kept the list it already had, since the station answers one, and pages it like the
/// others rather than asking for two hundred and stopping there.
/// </remarks>
public sealed partial class AlbumsViewModel(OperatorActions actions, HttpClient http, NavigationViewModel navigation)
    : PagedTabViewModel(actions, http)
{
    public ObservableCollection<AlbumRowViewModel> Albums { get; } = [];

    public IReadOnlyList<SortChoice<CatalogSort>> Sorts { get; } = CatalogSorts.Albums;

    [ObservableProperty]
    private SortChoice<CatalogSort> _sort = CatalogSorts.Albums[0];

    [ObservableProperty]
    private bool _descending;

    [ObservableProperty]
    private string? _empty;

    partial void OnSortChanged(SortChoice<CatalogSort> value) => Restart();

    partial void OnDescendingChanged(bool value) => Restart();

    [RelayCommand]
    private void TurnSort() => Descending = !Descending;

    [RelayCommand]
    private void Open(AlbumRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);
        navigation.Push(new Navigation.Destination.AlbumDetail(row.Id, row.Name));
    }

    protected override async Task<long?> ReadPageAsync(CancellationToken cancellationToken)
    {
        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.ListAlbumsAsync(
                    new CatalogQueryInput
                    {
                        Page = Page,
                        PageSize = PageSize,
                        Search = Term,
                        SortBy = Sort.Key,
                        Sort = Descending ? PaginationSort.Desc : PaginationSort.Asc,
                    },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return null;
        }

        Albums.Clear();
        foreach (var album in page.Data)
        {
            Albums.Add(Row(album, Station, Actions, Sdk));
        }

        Empty = Albums.Count > 0
            ? null
            : Term is { } term
                ? $"Nothing matches “{term}”. Try a shorter term, or part of the name rather than all of it."
                : "No releases yet. Records ingested outside any release are still under Records.";
        return page.Meta.Total;
    }

    /// <summary>A release as a row, rated where it is drawn. Shared with an act's page, which lists theirs.</summary>
    public static AlbumRowViewModel Row(Album album, Core.Station.StationUrl station, OperatorActions actions, Func<Sdk.DeadairSdk> sdk)
    {
        ArgumentNullException.ThrowIfNull(album);
        return new(
            album.Id,
            album.Name,
            album.ArtistName,
            album.Year,
            album.TrackCount,
            station.ArtUrl(album.ImageUrl),
            CatalogRatings.Album(actions, sdk, album.Id, album.Rating, album.Name));
    }

    public override void Reset()
    {
        base.Reset();
        Albums.Clear();
        Empty = null;
    }
}
