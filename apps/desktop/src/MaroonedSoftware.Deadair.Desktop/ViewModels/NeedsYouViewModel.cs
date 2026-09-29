using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Destination = MaroonedSoftware.Deadair.Desktop.Navigation.Destination;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One thing the station says needs somebody, and where it can be dealt with.</summary>
/// <param name="Page">Where its link goes, or null when this app has no page for it.</param>
/// <param name="Here">Whether that page is the desk this list is drawn on, where a link would go nowhere.</param>
public sealed record NeedsYouRowViewModel(
    string Title,
    string Detail,
    Severity Severity,
    long? Count,
    AttentionPage? Page,
    bool Here)
{
    /// <summary>Drawn only when the row is a group, so a single item is not labelled "1".</summary>
    public bool ShowsCount => Count is > 1;

    public bool HasLink => Page is not null && !Here;

    /// <summary>The destination, named as the sidebar names it, rather than a remedy the station never sent.</summary>
    public string LinkLabel => Page is { } page ? $"{AttentionRoutes.Label(page)} →" : string.Empty;

    /// <summary>Said instead of a link, so a row with none reads as this app's gap rather than a dead button.</summary>
    public bool CannotLink => Page is null;
}

/// <summary>
/// What the station says needs somebody: the list on the desk, and the badges on the sidebar.
/// </summary>
/// <remarks>
/// <para>
/// <b>Read on the running order's poll, every third tick</b>, which is fifteen seconds: the web
/// console's own cadence for this list, which it also keeps up in the background because the badges
/// are on every page. The order poll already runs on every page for an operator and on none for
/// anybody else, so riding it gives exactly that without a timer of its own. Its owner
/// (<see cref="RunningOrderViewModel"/>) calls <see cref="RefreshAsync"/>; the first reading of an
/// operator's session asks at once.
/// </para>
/// <para>
/// <b>A failed read keeps the last list and says it could not ask.</b> The list failing is not the
/// station failing, and saying which is the difference between a desk an operator trusts and one
/// they second-guess. It never reports through the page's notice line: a background read that had
/// failed would otherwise say so every fifteen seconds.
/// </para>
/// </remarks>
public sealed partial class NeedsYouViewModel(HttpClient http, NavigationViewModel navigation) : ObservableObject
{
    private StationUrl _station;

    /// <summary>Moved on by <see cref="Reset"/>, so a read begun for a session that has ended is dropped.</summary>
    private int _generation;

    public ObservableCollection<NeedsYouRowViewModel> Rows { get; } = [];

    /// <summary>Whether a reading has arrived. The heading's sentence waits for one.</summary>
    [ObservableProperty]
    private bool _hasReading;

    /// <summary>Whether there is anything to list, which is what draws the card at all.</summary>
    [ObservableProperty]
    private bool _hasRows;

    /// <summary>The line beside "Needs you", which changes with the count.</summary>
    [ObservableProperty]
    private string _summary = string.Empty;

    /// <summary>Said when the list could not be read, above whatever was read last.</summary>
    [ObservableProperty]
    private string? _problem;

    public void Attach(StationUrl station) => _station = station;

    /// <summary>Reads the list and redraws it and the sidebar's badges.</summary>
    public async Task RefreshAsync()
    {
        var generation = _generation;
        StationAttention attention;
        try
        {
            using var sdk = new DeadairSdk(new SdkOptions { BaseUrl = _station.ApiBase, HttpClient = http });
            attention = await sdk.Station.ReadStationAttentionAsync().ConfigureAwait(true);
        }
        catch (Exception failure) when (failure is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            if (generation != _generation)
            {
                return;
            }

            Problem = "The station could not be asked what needs you. Nothing is known to be wrong; this list is what is unavailable.";
            return;
        }

        if (generation == _generation)
        {
            Apply(attention);
        }
    }

    /// <summary>Draws a reading. Public so a frame can be posed without a station.</summary>
    public void Apply(StationAttention attention)
    {
        ArgumentNullException.ThrowIfNull(attention);

        Problem = null;
        HasReading = true;

        Rows.Clear();
        foreach (var item in attention.Items)
        {
            // The station writes the title and the sentence, and orders the list worst first. This
            // picks a colour and a link and changes no words.
            var page = AttentionRoutes.PageOf(item.Route);
            Rows.Add(new NeedsYouRowViewModel(
                item.Title,
                item.Detail,
                AttentionRoutes.SeverityOf(item.Severity),
                item.Count,
                page,
                Here: page == AttentionPage.Desk));
        }

        HasRows = Rows.Count > 0;

        // The reassurance is the point of the wording: nothing in this list takes the station off
        // air, and an operator who has learned that reads it without their stomach dropping.
        Summary = Rows.Count switch
        {
            0 => "Nothing is waiting on you.",
            1 => "1 thing, worst first. Nothing here is urgent enough to take the station off air.",
            var count => $"{count} things, worst first. Nothing here is urgent enough to take the station off air.",
        };

        Badge(AttentionRoutes.Counts(attention.Items));
    }

    /// <summary>Forgets the list and takes every badge down, when the operator signs out or the station changes.</summary>
    public void Reset()
    {
        _generation++;
        Rows.Clear();
        HasRows = false;
        HasReading = false;
        Summary = string.Empty;
        Problem = null;
        Badge(new Dictionary<AttentionPage, AttentionCount>());
    }

    [RelayCommand]
    private void Open(NeedsYouRowViewModel row)
    {
        if (row?.Page is { } page)
        {
            navigation.Show(DestinationOf(page));
        }
    }

    private void Badge(IReadOnlyDictionary<AttentionPage, AttentionCount> counts)
    {
        foreach (var item in navigation.Items)
        {
            var found = PageOf(item.Entry.Destination) is { } page && counts.TryGetValue(page, out var count)
                ? count
                : default;

            item.AttentionCount = found.Count;
            item.AttentionSeverity = found.Count > 0 ? found.Worst : Severity.Notice;
        }
    }

    private static Destination DestinationOf(AttentionPage page) => page switch
    {
        AttentionPage.Programme => new Destination.Programme(),
        AttentionPage.Library => new Destination.Library(),
        AttentionPage.Voice => new Destination.Voice(),
        AttentionPage.Checkup => new Destination.Checkup(),
        AttentionPage.Settings => new Destination.Settings(),
        _ => new Destination.Desk(),
    };

    private static AttentionPage? PageOf(Destination destination) => destination switch
    {
        Destination.Desk => AttentionPage.Desk,
        Destination.Programme => AttentionPage.Programme,
        Destination.Library => AttentionPage.Library,
        Destination.Voice => AttentionPage.Voice,
        Destination.Checkup => AttentionPage.Checkup,
        Destination.Settings => AttentionPage.Settings,
        _ => null,
    };
}
