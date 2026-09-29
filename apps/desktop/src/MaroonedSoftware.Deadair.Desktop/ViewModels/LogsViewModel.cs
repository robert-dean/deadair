using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>A log the station keeps, as the picker offers it.</summary>
public sealed record LogSourceViewModel(LogSource Source, string Label)
{
    public override string ToString() => Label;
}

/// <summary>A level the tail can be filtered to, or every level.</summary>
public sealed record LogLevelViewModel(string Label, LogLevel? Level)
{
    public override string ToString() => Label;
}

/// <summary>One line of a log.</summary>
/// <param name="Severity">The colour of a line whose level says something, and null for the rest.</param>
public sealed record LogLineViewModel(string? Stamp, string Text, Severity? Severity)
{
    public bool Painted => Severity is not null;
}

/// <summary>
/// The Logs tab: every log this install writes to disk, read without a shell on the box.
/// </summary>
/// <remarks>
/// <para>
/// <b>A picker rather than a card each.</b> An operator arrives here knowing which log they want, and
/// the height a log needs to be readable is a height only one of them can have. The first source is
/// open until somebody picks another: the station answers with its own log first, which is the one
/// somebody opening this came for.
/// </para>
/// <para>
/// <b>Only a source that grades its lines offers a level.</b> The station's lines carry a level it
/// wrote; the audio chain's and the shim's do not, and a level control over those would be a control
/// that appeared to work. It is not drawn for them, and not sent.
/// </para>
/// <para>
/// <b>Manage-only, as Cost is</b>: a log holds what a shell on the container would show, so a refusal is
/// a sentence here rather than "no longer an operator". Downloading goes through the save panel,
/// because a view model has no window (see Files in and out).
/// </para>
/// </remarks>
public sealed partial class LogsViewModel(OperatorActions actions, Func<DeadairSdk> sdk, IFilePicker files) : ObservableObject
{
    private const string Refused = "This account cannot read the station's logs. That needs an account that manages the station, not one that only views it.";

    private int _generation;
    private bool _choosing;

    public ObservableCollection<LogSourceViewModel> Sources { get; } = [];

    public ObservableCollection<LogLineViewModel> Lines { get; } = [];

    /// <summary>The levels, least severe first, after every level.</summary>
    public IReadOnlyList<LogLevelViewModel> Levels { get; } =
    [
        new("All levels", null),
        new("Trace", LogLevel.Trace),
        new("Debug", LogLevel.Debug),
        new("Info", LogLevel.Info),
        new("Warn", LogLevel.Warn),
        new("Error", LogLevel.Error),
    ];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Description))]
    [NotifyPropertyChangedFor(nameof(Grades))]
    [NotifyPropertyChangedFor(nameof(Present))]
    [NotifyPropertyChangedFor(nameof(LastWritten))]
    [NotifyCanExecuteChangedFor(nameof(RefreshCommand))]
    [NotifyCanExecuteChangedFor(nameof(DownloadCommand))]
    private LogSourceViewModel? _source;

    [ObservableProperty]
    private LogLevelViewModel? _level;

    [ObservableProperty]
    private string? _problem;

    /// <summary>Why the tail could not be read, or the download could not be saved.</summary>
    [ObservableProperty]
    private string? _tailProblem;

    [ObservableProperty]
    private bool _truncated;

    [ObservableProperty]
    private string? _empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(DownloadCommand))]
    private bool _downloading;

    public string? Description => Source?.Source.Description;

    public bool Grades => Source?.Source.Levels == true;

    public bool Present => Source?.Source.Present == true;

    public string? LastWritten => Source?.Source.LastWriteAt is { } at
        ? $"Last written {at.ToLocalTime().ToString("d MMM, HH:mm:ss", CultureInfo.InvariantCulture)}"
        : null;

    public bool HasSources => Sources.Count > 0;

    /// <summary>The sources, and then the tail of whichever is open.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        var reply = await ManageOnly.RunAsync(
            actions,
            async token =>
            {
                using var client = sdk();
                return await client.Logs.ListLogsAsync(token).ConfigureAwait(false);
            },
            cancellationToken).ConfigureAwait(true);

        if (reply.Refused)
        {
            Sources.Clear();
            Lines.Clear();
            OnPropertyChanged(nameof(HasSources));
            Problem = Refused;
            return;
        }

        if (reply.Value is not { } list)
        {
            Problem = Sources.Count > 0 ? null : "The list of logs could not be fetched.";
            return;
        }

        // The one the operator had open stays open across a visit, by id, since the rows are new.
        var keep = Source?.Source.Id;

        _choosing = true;
        Sources.Clear();
        foreach (var source in list.Sources)
        {
            Sources.Add(new LogSourceViewModel(source, LogWords.Offered(source)));
        }

        Source = Sources.FirstOrDefault(entry => entry.Source.Id == keep) ?? Sources.FirstOrDefault();
        Level ??= Levels[0];
        _choosing = false;

        OnPropertyChanged(nameof(HasSources));
        Problem = Sources.Count > 0 ? null : "This install writes nothing to disk that this app knows how to read.";

        await ReadTailAsync(cancellationToken).ConfigureAwait(true);
    }

    partial void OnSourceChanged(LogSourceViewModel? value)
    {
        if (!_choosing && value is not null)
        {
            _ = ReadTailAsync(CancellationToken.None);
        }
    }

    partial void OnLevelChanged(LogLevelViewModel? value)
    {
        if (!_choosing && Grades)
        {
            _ = ReadTailAsync(CancellationToken.None);
        }
    }

    [RelayCommand(CanExecute = nameof(CanRead))]
    private Task RefreshAsync(CancellationToken cancellationToken) => ReadTailAsync(cancellationToken);

    private bool CanRead() => Source is { Source.Present: true };

    [RelayCommand(CanExecute = nameof(CanDownload))]
    private async Task DownloadAsync(CancellationToken cancellationToken)
    {
        if (Source is not { } chosen)
        {
            return;
        }

        Downloading = true;
        TailProblem = null;
        try
        {
            var reply = await ManageOnly.RunAsync(
                actions,
                async token =>
                {
                    using var client = sdk();
                    return await client.Logs.DownloadLogAsync(chosen.Source.Id, token).ConfigureAwait(false);
                },
                cancellationToken).ConfigureAwait(true);

            if (reply.Refused)
            {
                TailProblem = Refused;
                return;
            }

            if (reply.Value is not { } download)
            {
                return;
            }

            // Cancelling the panel is an answer rather than a failure, so it says nothing.
            await files.SaveAsync(
                "Save the log",
                LogWords.DownloadName(download.Headers.ContentDisposition, chosen.Source.Id),
                Encoding.UTF8.GetBytes(download.Data)).ConfigureAwait(true);
        }
        finally
        {
            Downloading = false;
        }
    }

    private bool CanDownload() => CanRead() && !Downloading;

    private async Task ReadTailAsync(CancellationToken cancellationToken)
    {
        if (Source is not { } chosen)
        {
            return;
        }

        var generation = ++_generation;

        // Asking for a level the source cannot apply would put a filter on screen that does nothing,
        // so it is dropped at the point of asking rather than left to the station to ignore.
        var query = new LogQuery { Level = chosen.Source.Levels ? Level?.Level : null };

        var reply = await ManageOnly.RunAsync(
            actions,
            async token =>
            {
                using var client = sdk();
                return await client.Logs.ReadLogAsync(chosen.Source.Id, query, token).ConfigureAwait(false);
            },
            cancellationToken).ConfigureAwait(true);

        // A source picked while this was on its way makes it stale.
        if (generation != _generation)
        {
            return;
        }

        if (reply.Refused)
        {
            TailProblem = Refused;
            return;
        }

        if (reply.Value is not { } page)
        {
            TailProblem = "The tail could not be fetched.";
            return;
        }

        var offset = DateTimeOffset.Now.Offset;
        Lines.Clear();
        foreach (var line in page.Lines)
        {
            var text = line.Level is { } level ? $"[{level.ToString().ToLowerInvariant()}] {line.Text}" : line.Text;
            Lines.Add(new LogLineViewModel(LogWords.Stamp(line.Ts, offset), text, Paint(line.Level)));
        }

        // The stream logs are bounded by bytes, so the oldest line here is not the file's first.
        Truncated = page.Truncated;
        TailProblem = null;
        Empty = Lines.Count > 0
            ? null
            : chosen.Source.Present
                ? "Nothing here at this level."
                : LogWords.NothingWritten(chosen.Source.Id);
    }

    /// <summary>
    /// A warning and an error are painted, and the quieter levels are not. Info is left the page's
    /// own colour rather than the console's blue, because in a tail most lines are info and painting
    /// them all would leave nothing to stand out.
    /// </summary>
    private static Severity? Paint(LogLevel? level) => level switch
    {
        LogLevel.Error => Severity.Failure,
        LogLevel.Warn => Severity.Warning,
        _ => null,
    };
}
