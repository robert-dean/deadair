using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.History;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One thing the station played.</summary>
/// <param name="ArtworkUrl">
/// Already resolved against the station, so a row can be drawn without knowing where the station is.
/// Absent when the catalog holds no cover, which is ordinary rather than a failure.
/// </param>
public sealed record HistoryRowViewModel(
    string When,
    string Title,
    string Artists,
    bool NoAlbum,
    Uri? ArtworkUrl)
{
    /// <summary>The square drawn until, or instead of, a cover.</summary>
    public string Initial => Title.Length == 0 ? "?" : char.ToUpperInvariant(Title[0]).ToString();
}

/// <summary>One day of it, under the heading it goes below.</summary>
public sealed record HistoryDayViewModel(string Label, IReadOnlyList<HistoryRowViewModel> Rows);

/// <summary>
/// What the station has already played.
/// </summary>
/// <remarks>
/// The web console never reads this endpoint; the Android listener does. It belongs in a listener's
/// app rather than an operator's, which is why it is one of the two destinations that need no
/// account — somebody who heard something twenty minutes ago and wants its name should not have to
/// sign in to find out.
/// </remarks>
public sealed partial class HistoryViewModel(OperatorActions actions, HttpClient http) : ObservableObject
{
    private StationUrl _station;

    /// <summary>
    /// The history, cut into days.
    /// </summary>
    /// <remarks>
    /// A flat run of times is unreadable the moment it crosses midnight — 23:40 sits directly under
    /// 11:27 and nothing says a day went by. The cutting is <see cref="DayGroups"/>, out in Core with
    /// its own tests, because a boundary at the reader's own midnight is exactly the kind of thing
    /// that passes in one timezone and fails in another.
    /// </remarks>
    public ObservableCollection<HistoryDayViewModel> Days { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _problem;

    public void Attach(StationUrl station) => _station = station;

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        Problem = null;

        try
        {
            var page = await actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();
                    return await sdk.History.ReadHistoryAsync(new HistoryQuery { Limit = 100 }, token)
                        .ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (page is null)
            {
                return;
            }

            Days.Clear();

            var groups = DayGroups.Of(
                page.Entries,
                entry => entry.AiredAt,
                DateTimeOffset.Now,
                TimeZoneInfo.Local);

            foreach (var day in groups)
            {
                // `artists` is ONE line rather than a list, deliberately: that is how a release
                // credits itself, and splitting it renames any act with a comma in its name.
                var rows = day.Items
                    .Select(row => new HistoryRowViewModel(
                        row.AiredAt.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture),
                        row.Title,
                        row.Artists,
                        string.IsNullOrEmpty(row.Album),
                        _station.ArtUrl(row.ArtworkUrl)))
                    .ToList();

                Days.Add(new HistoryDayViewModel(day.Label, rows));
            }

            if (Days.Count == 0)
            {
                Problem = "The station has not played anything yet.";
            }
        }
        finally
        {
            Busy = false;
        }
    }

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = http,
    });
}
