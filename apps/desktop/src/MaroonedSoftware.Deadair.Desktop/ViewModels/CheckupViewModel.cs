using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One of the station's loops.</summary>
public sealed record LoopViewModel(string Name, string LastBeat, string Started);

/// <summary>Something that needs somebody.</summary>
/// <param name="Count">How many things this row stands for, when it stands for more than one.</param>
public sealed record AttentionViewModel(string Title, string Detail, Severity Severity, long? Count)
{
    /// <summary>Drawn only when the row is a group, so a single item is not labelled "1".</summary>
    public bool ShowsCount => Count is > 1;
}

/// <summary>One line of the station's activity.</summary>
public sealed record ActivityViewModel(string When, string Module, string Detail, Severity Severity);

/// <summary>
/// How the station is doing, assembled from the three readings that answer it.
/// </summary>
/// <remarks>
/// The check-up endpoint deliberately carries ONLY the two signals nothing else exposes — the loops
/// and the catalog backlog — because everything else a health page shows is already on a reading
/// somebody is polling. So this page reads three things and does not ask the station to compose a
/// verdict it has no business composing.
/// </remarks>
public sealed partial class CheckupViewModel(OperatorActions actions, HttpClient http) : ObservableObject
{
    private StationUrl _station;

    public ObservableCollection<LoopViewModel> Loops { get; } = [];

    public ObservableCollection<AttentionViewModel> Attention { get; } = [];

    public ObservableCollection<ActivityViewModel> Activity { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string _backlog = string.Empty;

    [ObservableProperty]
    private string? _revision;

    [ObservableProperty]
    private string _readAt = string.Empty;

    [ObservableProperty]
    private bool _nothingNeedsYou;

    public void Attach(StationUrl station) => _station = station;

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            await LoadMachineryAsync(cancellationToken).ConfigureAwait(true);
            await LoadAttentionAsync(cancellationToken).ConfigureAwait(true);
            await LoadActivityAsync(cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    private async Task LoadMachineryAsync(CancellationToken cancellationToken)
    {
        var checkup = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Station.ReadStationCheckupAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (checkup is null)
        {
            return;
        }

        // Stamped so a page left open overnight cannot pass itself off as now.
        ReadAt = $"Read at {checkup.ReadAt.ToLocalTime().ToString("HH:mm:ss", CultureInfo.InvariantCulture)}";

        // Absent is not a failed read: it means nothing stamped this build, which a development tree
        // and a hand-built image both are.
        Revision = checkup.Revision is { Length: > 0 } revision
            ? $"Built from {revision[..Math.Min(revision.Length, 12)]}"
            : "This build carries no revision stamp.";

        Loops.Clear();
        foreach (var beat in checkup.Heartbeats ?? [])
        {
            // Two timestamps and no verdict, because the station cannot supply one: a five-second
            // reconcile and a nightly sweep are both healthy and no single threshold describes both.
            Loops.Add(new LoopViewModel(
                beat.Name,
                beat.LastBeat is { } last ? Ago(last) : "has not come round yet",
                Ago(beat.StartedAt)));
        }

        Backlog = checkup.Backlog is { } backlog
            ? $"{backlog.Cached} of {backlog.Total} records held locally, {backlog.Measured} measured"
            : "The catalog backlog could not be read.";
    }

    private async Task LoadAttentionAsync(CancellationToken cancellationToken)
    {
        var attention = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Station.ReadStationAttentionAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (attention is null)
        {
            return;
        }

        Attention.Clear();
        foreach (var item in attention.Items)
        {
            // The station writes the title and the sentence. This picks a severity colour and changes
            // no words.
            Attention.Add(new AttentionViewModel(item.Title, item.Detail, Map(item.Severity), item.Count));
        }

        NothingNeedsYou = Attention.Count == 0;
    }

    private async Task LoadActivityAsync(CancellationToken cancellationToken)
    {
        var page = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Activity.ReadActivityAsync(new ActivityQuery { Limit = 60 }, token)
                    .ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return;
        }

        Activity.Clear();
        foreach (var entry in page.Entries)
        {
            Activity.Add(new ActivityViewModel(
                entry.At.ToLocalTime().ToString("HH:mm:ss", CultureInfo.InvariantCulture),
                entry.Module.ToString().ToLowerInvariant(),
                entry.Detail,
                Map(entry.Severity)));
        }
    }

    /// <summary>
    /// How long ago, in words.
    /// </summary>
    /// <remarks>
    /// Rounded rather than exact. Nobody reading a loop's last pass needs the seconds, and a figure
    /// that changes every time the page is opened reads as noise.
    /// </remarks>
    private static string Ago(DateTimeOffset when)
    {
        var since = DateTimeOffset.UtcNow - when;

        if (since < TimeSpan.Zero)
        {
            since = TimeSpan.Zero;
        }

        return since switch
        {
            { TotalSeconds: < 10 } => "just now",
            { TotalMinutes: < 1 } => $"{(int)since.TotalSeconds}s ago",
            { TotalHours: < 1 } => $"{(int)since.TotalMinutes}m ago",
            { TotalDays: < 1 } => $"{(int)since.TotalHours}h ago",
            _ => $"{(int)since.TotalDays}d ago",
        };
    }

    private static Severity Map(AttentionItemSeverity severity) => severity switch
    {
        AttentionItemSeverity.Failure => Severity.Failure,
        AttentionItemSeverity.Warning => Severity.Warning,
        _ => Severity.Notice,
    };

    /// <remarks>
    /// The feed's own words are `info`, `warn` and `fault` rather than the attention list's `notice`,
    /// `warning` and `failure`. Two vocabularies for one idea, so the mapping is written out rather
    /// than assumed to line up by name.
    /// </remarks>
    private static Severity Map(ActivitySeverity severity) => severity switch
    {
        ActivitySeverity.Fault => Severity.Failure,
        ActivitySeverity.Warn => Severity.Warning,
        _ => Severity.Notice,
    };

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = http,
    });
}
