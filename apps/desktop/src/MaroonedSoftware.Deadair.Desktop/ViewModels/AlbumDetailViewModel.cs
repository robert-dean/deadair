using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One release: the station's opinion of it, what the providers say, and its records.
/// </summary>
/// <remarks>
/// An opinion about the RELEASE is not an opinion about any one record on it: a dislike here takes the
/// whole thing out of rotation. Each record's credit is drawn as written on the release, which is not
/// always the act the release hangs off.
/// </remarks>
public sealed partial class AlbumDetailViewModel : CatalogDetailViewModel
{
    private readonly Guid _id;

    public AlbumDetailViewModel(CatalogPageContext context, Guid id, string name)
        : base(context, name)
    {
        _id = id;
        Pager = new DetailPager(() => ReadTracksAsync(CancellationToken.None));
    }

    public EnrichmentViewModel Enrichment { get; } = new(
        "No provider has been asked about this release yet. The enrichment pass picks up what it has not seen, oldest first.");

    public ObservableCollection<TrackRowViewModel> Tracks { get; } = [];

    public DetailPager Pager { get; }

    /// <summary>The act it hangs off, once the station has said, so the page can lead there.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasArtist))]
    private string? _artistName;

    private Guid _artistId;

    public bool HasArtist => ArtistName is not null;

    public string? NoTracks { get; private set; }

    [RelayCommand]
    private void OpenArtist()
    {
        if (ArtistName is { } name)
        {
            Context.Navigation.Push(new Navigation.Destination.ArtistDetail(_artistId, name));
        }
    }

    [RelayCommand]
    private void OpenTrack(TrackRowViewModel track)
    {
        ArgumentNullException.ThrowIfNull(track);
        Context.Navigation.Push(new Navigation.Destination.TrackDetail(track.Id, track.Title));
    }

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var album = await Context.Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.GetAlbumAsync(_id, token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [404] = "No release with that id is in the catalog." },
            cancellationToken).ConfigureAwait(true);

        if (album is null)
        {
            Problem = "This release could not be read.";
            return;
        }

        Present(album);
        await ReadTracksAsync(cancellationToken).ConfigureAwait(true);

        var enrichment = await Context.Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.GetAlbumEnrichmentAsync(_id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (enrichment is not null)
        {
            Enrichment.Reading = EnrichmentReading.From(enrichment);
        }
    }

    /// <summary>Draws the release the station answered with. Public so a frame can be posed from one.</summary>
    public void Present(Album album)
    {
        ArgumentNullException.ThrowIfNull(album);

        Name = album.Name;
        _artistId = album.ArtistId;
        ArtistName = album.ArtistName;
        Credit = TrackFacts.Credit(album.ArtistName, null, album.Year, null);
        ArtworkUrl = Context.Station.ArtUrl(album.ImageUrl);
        Rating = CatalogRatings.Album(Context.Actions, Sdk, album.Id, album.Rating, album.Name);
    }

    /// <summary>Draws a page of its records. Public so a frame can be posed from one.</summary>
    public void Present(TrackPage page)
    {
        ArgumentNullException.ThrowIfNull(page);

        Tracks.Clear();
        foreach (var row in page.Data)
        {
            Tracks.Add(new TrackRowViewModel(
                row,
                Context.Station.ArtUrl(row.AlbumImageUrl),
                CatalogRatings.Track(Context.Actions, Sdk, row.Id, row.Rating, row.Title),
                []));
        }

        Pager.Total = page.Meta.Total;
        NoTracks = Tracks.Count == 0 ? "This release has no records in the catalog." : null;
        OnPropertyChanged(nameof(NoTracks));
    }

    private async Task ReadTracksAsync(CancellationToken cancellationToken)
    {
        var page = await Context.Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.ListAlbumTracksAsync(
                    _id,
                    new TrackQueryInput { Page = Pager.Page, PageSize = DetailPager.Size, SortBy = TrackSort.Title, Sort = PaginationSort.Asc },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is not null)
        {
            Present(page);
        }
    }
}
