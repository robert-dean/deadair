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
public sealed record TrackRowViewModel(Guid Id, string Title, string Artists, string? Album, string Length, string? Year);

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
                    row.Year?.ToString(CultureInfo.InvariantCulture)));
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
