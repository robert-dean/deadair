using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One line of the station's activity.</summary>
public sealed record ActivityViewModel(string When, string Module, string Detail, Severity Severity)
{
    /// <summary>
    /// Only a warning or a fault is painted. Most of a feed is ordinary, and painting that too would
    /// leave nothing for the two that matter to stand out against.
    /// </summary>
    public bool Painted => Severity is not Severity.Notice;
}

/// <summary>One choice in a row of filter segments.</summary>
public sealed partial class FilterChoiceViewModel(string label, Action<FilterChoiceViewModel> chosen) : ObservableObject
{
    public string Label { get; } = label;

    [ObservableProperty]
    private bool _isSelected;

    partial void OnIsSelectedChanged(bool value)
    {
        // A radio group unchecks the old choice as it checks the new one, and only the check is news.
        if (value)
        {
            chosen(this);
        }
    }
}

/// <summary>
/// The History tab: what the station has been doing, newest first.
/// </summary>
/// <remarks>
/// <para>
/// <b>A page at a time, and more only when asked.</b> The first page is read when the tab opens and
/// "Load more" reads the next, through the feed's keyset cursor rather than an offset: rows arrive at
/// the head continuously, and an offset would show a row again on every page as the feed grew under
/// it. Nothing polls. The web console refreshes its feed on a timer, and the desktop does not,
/// because the station rate-limits and nobody reads a feed that moves under them.
/// </para>
/// <para>
/// <b>A filter starts again from the top.</b> A cursor is a place in one filtered list, and handing it
/// to a differently filtered one would answer with a page from the middle of nowhere.
/// </para>
/// </remarks>
public sealed partial class ActivityFeedViewModel : ObservableObject
{
    /// <summary>The filter chips, in the order an operator meets them: what airs first, what makes it after.</summary>
    private static readonly (string Label, ActivityModule? Module)[] Modules =
    [
        ("Everything", null),
        ("Playout", ActivityModule.Playout),
        ("Programming", ActivityModule.Director),
        ("Breaks", ActivityModule.Render),
        ("Catalog", ActivityModule.Catalog),
        ("Plugins", ActivityModule.Plugins),
        ("Storage", ActivityModule.Storage),
    ];

    private static readonly (string Label, ActivitySeverity? Floor)[] Severities =
    [
        ("All", null),
        ("Warnings", ActivitySeverity.Warn),
        ("Faults", ActivitySeverity.Fault),
    ];

    private const int PageSize = 50;

    private readonly OperatorActions _actions;
    private readonly Func<DeadairSdk> _sdk;
    private ActivityModule? _module;
    private ActivitySeverity? _floor;
    private string? _nextBefore;

    // Which read is current. A filter pressed while a page is on its way makes that page stale, and
    // it must not land in the list the new filter is filling.
    private int _generation;

    // True while the constructor selects the defaults, which are not a choice anybody made.
    private bool _suppress;

    public ActivityFeedViewModel(OperatorActions actions, Func<DeadairSdk> sdk)
    {
        _actions = actions;
        _sdk = sdk;

        foreach (var (label, module) in Modules)
        {
            ModuleChoices.Add(new FilterChoiceViewModel(label, _ => Refilter(() => _module = module)));
        }

        foreach (var (label, floor) in Severities)
        {
            SeverityChoices.Add(new FilterChoiceViewModel(label, _ => Refilter(() => _floor = floor)));
        }

        // Selected before anything listens for it, so the first choice is not a read.
        _suppress = true;
        ModuleChoices[0].IsSelected = true;
        SeverityChoices[0].IsSelected = true;
        _suppress = false;
    }

    public ObservableCollection<ActivityViewModel> Entries { get; } = [];

    public ObservableCollection<FilterChoiceViewModel> ModuleChoices { get; } = [];

    public ObservableCollection<FilterChoiceViewModel> SeverityChoices { get; } = [];

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(LoadMoreCommand))]
    private bool _busy;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(LoadMoreCommand))]
    private bool _canLoadMore;

    /// <summary>What an empty list says, which depends on whether a filter emptied it.</summary>
    [ObservableProperty]
    private string? _empty;

    /// <summary>The first page, from the top.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        var generation = ++_generation;
        var page = await ReadAsync(before: null, cancellationToken).ConfigureAwait(true);

        if (page is null || generation != _generation)
        {
            return;
        }

        Entries.Clear();
        Append(page);
    }

    [RelayCommand(CanExecute = nameof(CanLoadMoreNow))]
    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        if (_nextBefore is not { } before)
        {
            return;
        }

        var generation = _generation;
        var page = await ReadAsync(before, cancellationToken).ConfigureAwait(true);

        if (page is null || generation != _generation)
        {
            return;
        }

        Append(page);
    }

    private bool CanLoadMoreNow() => CanLoadMore && !Busy;

    private void Refilter(Action apply)
    {
        if (_suppress)
        {
            return;
        }

        apply();
        _ = LoadAsync(CancellationToken.None);
    }

    private async Task<ActivityPage?> ReadAsync(string? before, CancellationToken cancellationToken)
    {
        var query = new ActivityQuery
        {
            Limit = PageSize,
            Before = before,
            Module = _module,
            MinSeverity = _floor,
        };

        Busy = true;
        try
        {
            return await _actions.RunAsync(
                async token =>
                {
                    using var client = _sdk();
                    return await client.Activity.ReadActivityAsync(query, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    private void Append(ActivityPage page)
    {
        var now = DateTimeOffset.Now;
        foreach (var entry in page.Entries)
        {
            // The sentence is left exactly as the station composed it.
            Entries.Add(new ActivityViewModel(
                CheckupWords.Moment(now, entry.At),
                entry.Module.ToString().ToLowerInvariant(),
                entry.Detail,
                Map(entry.Severity)));
        }

        _nextBefore = page.NextBefore;
        CanLoadMore = page.NextBefore is not null;
        Empty = Entries.Count > 0
            ? null
            : _module is null && _floor is null
                ? "Nothing yet. The station writes here as it airs records, makes breaks and changes what it is doing."
                : "Nothing matches that filter.";
    }

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
}
