using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using MaroonedSoftware.Deadair.Desktop.Core.Playout;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One of the station's loops, with how long since it last came round and since it started.</summary>
public sealed record LoopViewModel(string Name, string LastBeat, string Started);

/// <summary>Something that needs somebody.</summary>
/// <param name="Count">How many things this row stands for, when it stands for more than one.</param>
public sealed record AttentionViewModel(string Title, string Detail, Severity Severity, long? Count)
{
    /// <summary>Drawn only when the row is a group, so a single item is not labelled "1".</summary>
    public bool ShowsCount => Count is > 1;
}

/// <summary>Where the station can be listened to, one line per mount.</summary>
/// <param name="Url">The whole address rather than the path the status carries, since a path is
/// not something anybody can paste into a speaker or a car stereo.</param>
public sealed record MountViewModel(string Format, string Url, string Rate);

/// <summary>One content store on the station's disk.</summary>
/// <param name="Unclaimed">Files no row claims, or null when there are none.</param>
/// <param name="Missing">Claims whose file is gone, or null when there are none.</param>
public sealed record StoreViewModel(string Label, string Size, string Files, string? Unclaimed, string? Missing);

/// <summary>
/// The Machinery tab: how the station is doing now, assembled from the readings that answer it.
/// </summary>
/// <remarks>
/// <para>
/// The check-up endpoint deliberately carries ONLY the two signals nothing else exposes (the loops
/// and the catalog backlog), because everything else a health page shows is already on a reading of
/// its own. So this tab reads five things (playout, attention, the check-up, the disk and the
/// releases) and never asks the station to compose a verdict it has no business composing.
/// </para>
/// <para>
/// <b>Every section fails on its own</b>, which is the web console's rule and the reason the page is
/// worth having: a page that says what is wrong is the worst place for one dead reader to blank the
/// rest. A section that has never been read says so where its content would be; one that was read
/// before keeps its last reading, as the listener's poll does.
/// </para>
/// </remarks>
public sealed partial class MachineryViewModel(OperatorActions actions, Func<DeadairSdk> sdk) : ObservableObject
{
    /// <summary>What a section that could not be read says in its own box.</summary>
    public const string Unread = "This could not be read. The rest of the page is unaffected.";

    private string _origin = string.Empty;

    public ObservableCollection<LoopViewModel> Loops { get; } = [];

    public ObservableCollection<AttentionViewModel> Attention { get; } = [];

    public ObservableCollection<MountViewModel> Mounts { get; } = [];

    public ObservableCollection<string> StaleConfig { get; } = [];

    public ObservableCollection<StoreViewModel> Stores { get; } = [];

    /// <summary>Asked by "See what changed", which is the parent's to answer.</summary>
    public Action? OpenReleases { get; set; }

    // On air.

    [ObservableProperty]
    private bool _hasPlayout;

    [ObservableProperty]
    private string? _playoutProblem;

    [ObservableProperty]
    private StatusTone _silenceTone = StatusTone.Off;

    [ObservableProperty]
    private string _silence = string.Empty;

    [ObservableProperty]
    private string? _remedy;

    [ObservableProperty]
    private string _listeners = string.Empty;

    [ObservableProperty]
    private string _stream = string.Empty;

    [ObservableProperty]
    private string _queued = string.Empty;

    // Needs you.

    [ObservableProperty]
    private string? _attentionProblem;

    [ObservableProperty]
    private bool _nothingNeedsYou;

    // The check-up: loops, backlog and build.

    [ObservableProperty]
    private string? _checkupProblem;

    [ObservableProperty]
    private string _readAt = string.Empty;

    [ObservableProperty]
    private string? _loopsNote;

    /// <summary>Whether there are loops to put column headings over.</summary>
    [ObservableProperty]
    private bool _hasLoops;

    [ObservableProperty]
    private bool _hasBacklog;

    [ObservableProperty]
    private string? _backlogNote;

    [ObservableProperty]
    private string _records = string.Empty;

    [ObservableProperty]
    private string _cached = string.Empty;

    [ObservableProperty]
    private string _measured = string.Empty;

    [ObservableProperty]
    private double _measuredPercent;

    [ObservableProperty]
    private string? _version;

    [ObservableProperty]
    private string? _revision;

    [ObservableProperty]
    private string _build = string.Empty;

    // The disk.

    [ObservableProperty]
    private string? _storageProblem;

    [ObservableProperty]
    private string? _storageReadAt;

    // The release line under the build.

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ReleaseLink))]
    private string? _newerRelease;

    /// <summary>The words on the way to What's new, which name a newer release when there is one.</summary>
    public string ReleaseLink => NewerRelease is null ? "What changed in this release" : "See what changed";

    public void Attach(string origin) => _origin = origin;

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        // One after another rather than all at once: five requests on a visit is nothing to the
        // station's limit, and a burst of them at the same instant is exactly what it limits.
        await LoadPlayoutAsync(cancellationToken).ConfigureAwait(true);
        await LoadAttentionAsync(cancellationToken).ConfigureAwait(true);
        await LoadCheckupAsync(cancellationToken).ConfigureAwait(true);
        await LoadStorageAsync(cancellationToken).ConfigureAwait(true);
        await LoadReleasesAsync(cancellationToken).ConfigureAwait(true);
    }

    [RelayCommand]
    private void SeeReleases() => OpenReleases?.Invoke();

    private async Task LoadPlayoutAsync(CancellationToken cancellationToken)
    {
        var status = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Playout.GetPlayoutStatusAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (status is null)
        {
            PlayoutProblem = HasPlayout ? null : Unread;
            return;
        }

        // The station's own verdict and its own words: eleven gates composed in causal order. A
        // sentence of this app's own would be a second answer to disagree with the first.
        SilenceTone = SilenceReading.ToneFor(status.Silence.Cause);
        Silence = status.Silence.Detail;
        Remedy = status.Silence.Remedy;
        Listeners = CheckupWords.Count(status.Listeners);
        Stream = status.StreamUp ? "up" : "unreachable";
        Queued = CheckupWords.Count(status.QueuedCount);

        Mounts.Clear();
        foreach (var mount in status.Mounts)
        {
            // FLAC has no bitrate to report, which is a fact about the format rather than a figure
            // nobody filled in, so it says what it is instead of going blank.
            Mounts.Add(new MountViewModel(
                mount.Format.ToString().ToUpperInvariant(),
                _origin + mount.Path,
                mount.BitrateKbps is { } kbps ? $"{kbps} kbps" : "lossless"));
        }

        // A container running config that was replaced is never the CAUSE of a silence, and is the
        // reason the next attempt to go on air will fail.
        StaleConfig.Clear();
        foreach (var warning in status.StaleStreamConfig)
        {
            StaleConfig.Add($"{warning.Container.ToString().ToLowerInvariant()}: {warning.Detail}");
        }

        HasPlayout = true;
        PlayoutProblem = null;
    }

    private async Task LoadAttentionAsync(CancellationToken cancellationToken)
    {
        var attention = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Station.ReadStationAttentionAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (attention is null)
        {
            AttentionProblem = Attention.Count > 0 || NothingNeedsYou ? null : Unread;
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
        AttentionProblem = null;
    }

    private async Task LoadCheckupAsync(CancellationToken cancellationToken)
    {
        var checkup = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Station.ReadStationCheckupAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (checkup is null)
        {
            CheckupProblem = ReadAt.Length > 0 ? null : Unread;
            return;
        }

        var now = DateTimeOffset.Now;

        // Stamped so a page left open overnight cannot pass itself off as now.
        ReadAt = $"Read at {checkup.ReadAt.ToLocalTime().ToString("HH:mm:ss", CultureInfo.InvariantCulture)}";

        // Absent rather than empty means that reader failed, which the station distinguishes on
        // purpose: a station with no loops running is not the same as one that could not be asked.
        Loops.Clear();
        if (checkup.Heartbeats is not { } beats)
        {
            HasLoops = false;
            LoopsNote = "The station could not say what its loops are doing.";
        }
        else
        {
            foreach (var beat in beats)
            {
                // Two timestamps and no verdict, because the station cannot supply one: a five-second
                // reconcile and a nightly sweep are both healthy and no threshold describes both. A
                // loop that has never finished a pass says so rather than showing a dash, and its
                // start beside it tells a slow first pass from a stopped loop.
                Loops.Add(new LoopViewModel(
                    beat.Name,
                    beat.LastBeat is { } last ? CheckupWords.Ago(now, last) : "not yet",
                    CheckupWords.Ago(now, beat.StartedAt)));
            }

            HasLoops = beats.Count > 0;
            LoopsNote = beats.Count == 0
                ? "Nothing is being watched, which on a running station means the loops have not registered yet."
                : null;
        }

        if (checkup.Backlog is { } backlog)
        {
            Records = CheckupWords.Count(backlog.Total);
            Cached = CheckupWords.Count(backlog.Cached);
            Measured = CheckupWords.Count(backlog.Measured);
            MeasuredPercent = CheckupWords.Measured(backlog.Measured, backlog.Total);
            HasBacklog = true;
            BacklogNote = null;
        }
        else
        {
            HasBacklog = false;
            BacklogNote = "The catalog could not be counted.";
        }

        // Absent is not a failed read: it means nothing stamped this build, which a development tree
        // and a hand-built image both are. The version is absent far more often than the revision,
        // since a station following `latest` is a commit and no release, and saying "no version"
        // would read as a fault on a station working exactly as intended.
        Version = checkup.Version;
        Revision = checkup.Revision;
        Build = (checkup.Revision, checkup.Version) switch
        {
            ({ Length: > 0 } revision, _) => $"Built from {revision[..Math.Min(revision.Length, 7)]}",
            (_, { } version) => $"This station is {version}, and nothing recorded which commit it was built from.",
            _ => "This station was not built from a commit, which is what a development tree and a hand-built image both are.",
        };

        CheckupProblem = null;
    }

    private async Task LoadStorageAsync(CancellationToken cancellationToken)
    {
        var storage = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Storage.ReadStorageAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (storage is null)
        {
            StorageProblem = Stores.Count > 0 ? null : Unread;
            return;
        }

        Stores.Clear();
        foreach (var store in storage.Stores)
        {
            // Files no row claims, and claims whose file is gone. Reported rather than reconciled,
            // because the two disagree in different directions and each means something different.
            Stores.Add(new StoreViewModel(
                store.Label,
                CheckupWords.Bytes(store.Bytes),
                CheckupWords.Counted(store.Files, "file", "files"),
                store.OrphanFiles == 0 ? null : $"{CheckupWords.Count(store.OrphanFiles)} unclaimed",
                store.RowsWithNoFile == 0 ? null : $"{CheckupWords.Count(store.RowsWithNoFile)} missing"));
        }

        // The store's own reading time: a disk walk is expensive enough to be cached, and this is
        // what stops the figure passing for live.
        StorageReadAt = $"Read at {storage.ReadAt.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture)}";
        StorageProblem = null;
    }

    private async Task LoadReleasesAsync(CancellationToken cancellationToken)
    {
        // Quietly: the line is the plain link while this has not arrived or failed, which is true
        // either way, so a failure here is not worth a sentence at the foot of the page.
        StationReleases? releases;
        try
        {
            using var client = sdk();
            releases = await client.Station.ReadStationReleasesAsync(cancellationToken).ConfigureAwait(true);
        }
        catch (Sdk.Runtime.SdkException)
        {
            return;
        }
        catch (HttpRequestException)
        {
            return;
        }

        NewerRelease = releases.Available is [var newest, ..] ? $"deadair {newest.Version} is out." : null;
    }

    private static Severity Map(AttentionItemSeverity severity) => severity switch
    {
        AttentionItemSeverity.Failure => Severity.Failure,
        AttentionItemSeverity.Warning => Severity.Warning,
        _ => Severity.Notice,
    };
}
