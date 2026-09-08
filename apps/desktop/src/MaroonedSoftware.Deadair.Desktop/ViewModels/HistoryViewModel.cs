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

/// <summary>One thing the station played.</summary>
public sealed record HistoryRowViewModel(string When, string Title, string Artists, bool NoAlbum);

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

    public ObservableCollection<HistoryRowViewModel> Rows { get; } = [];

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

            Rows.Clear();
            foreach (var row in page.Entries)
            {
                // `artists` is ONE line rather than a list, deliberately: that is how a release
                // credits itself, and splitting it renames any act with a comma in its name.
                Rows.Add(new HistoryRowViewModel(
                    row.AiredAt.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture),
                    row.Title,
                    row.Artists,
                    string.IsNullOrEmpty(row.Album)));
            }

            if (Rows.Count == 0)
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
