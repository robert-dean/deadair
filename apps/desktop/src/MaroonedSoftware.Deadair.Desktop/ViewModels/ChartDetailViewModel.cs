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

/// <summary>One place on a chart.</summary>
public sealed record ChartPlaceViewModel(string Rank, string Title, string Artist, string? Album, string Run);

/// <summary>
/// One chart, read before anybody puts it on air.
/// </summary>
/// <remarks>
/// Putting a chart on air replaces the running order, so this page exists to answer "what would that
/// be?" before the answer is on the radio. It reads the chart once, when it opens: an edition does not
/// change while somebody is looking at it.
/// </remarks>
public sealed partial class ChartDetailViewModel(
    OperatorActions actions,
    HttpClient http,
    StationUrl station,
    ChartRowViewModel chart,
    IAsyncRelayCommand<ChartRowViewModel> play,
    Action<string>? find = null) : ObservableObject
{
    public ChartRowViewModel Chart { get; } = chart;

    public string Name => Chart.Name;

    public string Source => Chart.Source;

    public string? Description => Chart.Description;

    public bool HasDescription => Chart.HasDescription;

    /// <summary>
    /// Offered only once the edition has records: a chart that has not published yet today answers
    /// with none, and airing that would replace the running order with nothing.
    /// </summary>
    [ObservableProperty]
    private bool _canAir;

    /// <summary>The library's own Put on air, so the two places it is offered cannot behave differently.</summary>
    public IAsyncRelayCommand<ChartRowViewModel> PlayCommand { get; } = play;

    public ObservableCollection<ChartPlaceViewModel> Places { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _summary;

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var page = await actions.RunAsync(
                async token =>
                {
                    using var sdk = new DeadairSdk(new SdkOptions { BaseUrl = station.ApiBase, HttpClient = http });
                    return await sdk.Charts.ReadChartAsync(Chart.Id, new ChartQuery { Limit = 100 }, token)
                        .ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (page is null)
            {
                return;
            }

            Places.Clear();
            foreach (var record in page.Records)
            {
                Places.Add(Place(record));
            }

            CanAir = Places.Count > 0;

            // An empty chart is an answer rather than a failure: the station says a chart it could
            // not read comes back with no records, because a chart is never something it needs.
            Summary = Places.Count == 0
                ? "The station could not read this chart just now, so there is nothing to show."
                : $"{Places.Count} records";
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>
    /// Looks for a place's record in the library. A search rather than a claim that the station holds
    /// it: a chart carries no catalog id, and this asks the question rather than pretending to know.
    /// </summary>
    [RelayCommand]
    private void Find(ChartPlaceViewModel place)
    {
        ArgumentNullException.ThrowIfNull(place);
        find?.Invoke(place.Title);
    }

    /// <summary>A record's place, with its run on the chart where the source keeps one.</summary>
    public static ChartPlaceViewModel Place(ChartRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);

        var artist = record.Featuring is { Count: > 0 } featuring
            ? $"{record.Artist} feat. {string.Join(", ", featuring)}"
            : record.Artist;

        var run = (record.Peak, record.WeeksOn) switch
        {
            ({ } peak, { } weeks) => $"peak {peak} · {weeks} wk",
            ({ } peak, null) => $"peak {peak}",
            (null, { } weeks) => $"{weeks} wk",
            _ => string.Empty,
        };

        var album = record.Year is { } year
            ? $"{record.Album ?? string.Empty}{(record.Album is null ? string.Empty : ", ")}{year.ToString(CultureInfo.InvariantCulture)}"
            : record.Album;

        return new ChartPlaceViewModel(record.Rank.ToString(CultureInfo.InvariantCulture), record.Title, artist, album, run);
    }
}
