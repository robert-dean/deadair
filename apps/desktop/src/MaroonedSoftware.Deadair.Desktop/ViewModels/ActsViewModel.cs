using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One act.</summary>
public sealed class ArtistRowViewModel(Guid id, string name, long albums, long tracks, Uri? artworkUrl, RatingViewModel rating)
{
    public Guid Id { get; } = id;

    public string Name { get; } = name;

    /// <summary>How much of them the station has, as one figure.</summary>
    public string Holding { get; } = $"{Plural(albums, "release")} · {Plural(tracks, "record")}";

    public Uri? ArtworkUrl { get; } = artworkUrl;

    public RatingViewModel Rating { get; } = rating;

    public string Initial => Name.Length == 0 ? "?" : char.ToUpperInvariant(Name[0]).ToString();

    internal static string Plural(long count, string noun) => count == 1 ? $"1 {noun}" : $"{count} {noun}s";
}

/// <summary>
/// Every act the station has, rated from the list.
/// </summary>
/// <remarks>
/// Rated from the list rather than only from the act's own page: an operator forms most of these
/// opinions while browsing, and a rating that costs a page each way is one nobody records.
/// </remarks>
public sealed partial class ActsViewModel(OperatorActions actions, HttpClient http) : PagedTabViewModel(actions, http)
{
    public ObservableCollection<ArtistRowViewModel> Artists { get; } = [];

    public IReadOnlyList<SortChoice<CatalogSort>> Sorts { get; } = CatalogSorts.Artists;

    [ObservableProperty]
    private SortChoice<CatalogSort> _sort = CatalogSorts.Artists[0];

    [ObservableProperty]
    private bool _descending;

    [ObservableProperty]
    private string? _empty;

    partial void OnSortChanged(SortChoice<CatalogSort> value) => Restart();

    partial void OnDescendingChanged(bool value) => Restart();

    [RelayCommand]
    private void TurnSort() => Descending = !Descending;

    protected override async Task<long?> ReadPageAsync(CancellationToken cancellationToken)
    {
        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.ListArtistsAsync(
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

        Artists.Clear();
        foreach (var artist in page.Data)
        {
            Artists.Add(Row(artist));
        }

        Empty = Artists.Count > 0
            ? null
            : Term is { } term
                ? $"Nothing matches “{term}”. Try a shorter term, or part of the name rather than all of it."
                : "The catalog is empty. It fills as enabled plugins are scanned, and nothing has been ingested yet.";
        return page.Meta.Total;
    }

    private ArtistRowViewModel Row(Artist artist) => new(
        artist.Id,
        artist.Name,
        artist.AlbumCount,
        artist.TrackCount,
        Station.ArtUrl(artist.ImageUrl),
        new RatingViewModel(artist.Rating, artist.Name, async (chosen, cancellationToken) =>
        {
            var rated = await Actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();
                    return await sdk.Catalog.RateArtistAsync(artist.Id, new RateInput { Rating = chosen }, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);
            return rated?.Rating;
        }));

    public override void Reset()
    {
        base.Reset();
        Artists.Clear();
        Empty = null;
    }
}
