using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One act: the station's opinion of them, what the providers say, and their releases.
/// </summary>
/// <remarks>
/// The widest opinion there is: a dislike here takes every record they are credited on out of
/// rotation, whatever the records themselves say.
/// </remarks>
public sealed partial class ArtistDetailViewModel : CatalogDetailViewModel
{
    private readonly Guid _id;

    public ArtistDetailViewModel(CatalogPageContext context, Guid id, string name)
        : base(context, name)
    {
        _id = id;
        Pager = new DetailPager(() => ReadAlbumsAsync(CancellationToken.None));
    }

    public EnrichmentViewModel Enrichment { get; } = new(
        "No provider has been asked about this act yet. The enrichment pass picks up what it has not seen, oldest first.");

    public ObservableCollection<AlbumRowViewModel> Albums { get; } = [];

    public DetailPager Pager { get; }

    /// <summary>Said when the station answered with no releases, which is not the same as no records.</summary>
    public string? NoAlbums { get; private set; }

    [RelayCommand]
    private void OpenAlbum(AlbumRowViewModel album)
    {
        ArgumentNullException.ThrowIfNull(album);
        Context.Navigation.Push(new Navigation.Destination.AlbumDetail(album.Id, album.Name));
    }

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var artist = await Context.Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.GetArtistAsync(_id, token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [404] = "No act with that id is in the catalog." },
            cancellationToken).ConfigureAwait(true);

        if (artist is null)
        {
            // One sentence about an act that is not there is enough; a second about their providers
            // says nothing new.
            Problem = "This act could not be read.";
            return;
        }

        Present(artist);
        await ReadAlbumsAsync(cancellationToken).ConfigureAwait(true);

        var enrichment = await Context.Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.GetArtistEnrichmentAsync(_id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (enrichment is not null)
        {
            Enrichment.Reading = EnrichmentReading.From(enrichment);
        }
    }

    /// <summary>Draws the act the station answered with. Public so a frame can be posed from one.</summary>
    public void Present(Artist artist)
    {
        ArgumentNullException.ThrowIfNull(artist);

        Name = artist.Name;
        Credit = $"{ArtistRowViewModel.Plural(artist.AlbumCount, "release")} · {ArtistRowViewModel.Plural(artist.TrackCount, "record")}";
        ArtworkUrl = Context.Station.ArtUrl(artist.ImageUrl);
        Rating = CatalogRatings.Artist(Context.Actions, Sdk, artist.Id, artist.Rating, artist.Name);
    }

    /// <summary>Draws a page of their releases. Public so a frame can be posed from one.</summary>
    public void Present(AlbumPage page)
    {
        ArgumentNullException.ThrowIfNull(page);

        Albums.Clear();
        foreach (var album in page.Data)
        {
            Albums.Add(AlbumsViewModel.Row(album, Context.Station, Context.Actions, Sdk));
        }

        Pager.Total = page.Meta.Total;
        NoAlbums = Albums.Count == 0
            ? "Nothing by this act has been ingested as a release. Their records may still be in the catalog, filed without one."
            : null;
        OnPropertyChanged(nameof(NoAlbums));
    }

    private async Task ReadAlbumsAsync(CancellationToken cancellationToken)
    {
        var page = await Context.Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.ListArtistAlbumsAsync(
                    _id,
                    new CatalogQueryInput { Page = Pager.Page, PageSize = DetailPager.Size, SortBy = CatalogSort.Name, Sort = PaginationSort.Asc },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is not null)
        {
            Present(page);
        }
    }
}
