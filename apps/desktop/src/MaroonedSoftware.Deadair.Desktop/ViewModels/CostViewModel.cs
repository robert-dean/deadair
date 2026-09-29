using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One call a decision made, opened.</summary>
public sealed record SpanViewModel(string Spent, bool Failed, string Op, string? Target, string? Error, string? Detail);

/// <summary>One decision in the Cost tab's table, which opens in place to show its calls.</summary>
public sealed partial class DecisionRowViewModel(
    string id,
    string when,
    DecisionReading reading,
    string kind,
    int depth,
    string spent,
    long calls,
    long failed) : ObservableObject
{
    public string Id { get; } = id;

    public string When { get; } = when;

    public string Sentence { get; } = reading.Sentence;

    /// <summary>The raw kind, drawn dimmed under the sentence except where the sentence already is it.</summary>
    public string? Kind { get; } = reading.ShowsKind ? kind : null;

    /// <summary>
    /// The indent that carries the causal edge. Twenty a level, as the console draws it, and capped
    /// so a deep chain cannot push the sentence out of its own column.
    /// </summary>
    public Avalonia.Thickness Indent { get; } = new(Math.Min(depth, 4) * 20, 0, 0, 0);

    /// <summary>A caused decision also says so with a mark, so nobody has to measure whitespace.</summary>
    public bool IsCaused { get; } = depth > 0;

    public string Spent { get; } = spent;

    public string Calls { get; } = CheckupWords.Count(calls);

    public string? Failed { get; } = failed > 0 ? CheckupWords.Count(failed) : null;

    public ObservableCollection<SpanViewModel> Spans { get; } = [];

    [ObservableProperty]
    private bool _isOpen;

    /// <summary>Which decision caused this one, and what it went on to cause, in a line each.</summary>
    [ObservableProperty]
    private string? _lineage;

    /// <summary>Why the calls are not shown, when they could not be read.</summary>
    [ObservableProperty]
    private string? _problem;

    /// <summary>Whether the calls have been read, so opening it again does not read them again.</summary>
    public bool Read { get; set; }
}

/// <summary>
/// The Cost tab: every call the station made, filed under the decision that made it.
/// </summary>
/// <remarks>
/// <para>
/// <b>A table rather than sentences.</b> Every row is four numbers about one decision, and the
/// question an operator brings is comparative, which a column of figures answers at a glance.
/// </para>
/// <para>
/// <b>A row opens in place</b> rather than onto a page of its own: what somebody wants from a decision
/// is its calls read against the decisions around it, and a detail page would take those away. One
/// is open at a time, and its calls are read the first time it opens.
/// </para>
/// <para>
/// <b>It does not poll</b>, even while open. These rows were written when the work happened and cannot
/// change, so a timer would re-read the whole window to learn what it already knows.
/// </para>
/// <para>
/// <b>Manage-only.</b> The spans hold prompts' costs and plugin targets, so the endpoint sits on
/// <c>platform.manage</c>, and a refusal is a sentence on the tab rather than "no longer an operator".
/// </para>
/// </remarks>
public sealed partial class CostViewModel : ObservableObject
{
    private const string Refused = "This account cannot read what the station spent. That needs an account that manages the station, not one that only views it.";

    private readonly OperatorActions _actions;
    private readonly Func<DeadairSdk> _sdk;
    private bool _failedOnly;
    private bool _suppress;
    private int _generation;

    public CostViewModel(OperatorActions actions, Func<DeadairSdk> sdk)
    {
        _actions = actions;
        _sdk = sdk;

        Filters.Add(new FilterChoiceViewModel("Everything", _ => Refilter(failedOnly: false)));
        Filters.Add(new FilterChoiceViewModel("Only failures", _ => Refilter(failedOnly: true)));

        _suppress = true;
        Filters[0].IsSelected = true;
        _suppress = false;
    }

    public ObservableCollection<DecisionRowViewModel> Decisions { get; } = [];

    public ObservableCollection<FilterChoiceViewModel> Filters { get; } = [];

    /// <summary>The open row. Choosing another closes this one; choosing it again closes it.</summary>
    [ObservableProperty]
    private DecisionRowViewModel? _selected;

    [ObservableProperty]
    private string? _problem;

    [ObservableProperty]
    private string? _empty;

    [ObservableProperty]
    private string? _showing;

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        var generation = ++_generation;
        var query = new TracesQuery { FailedOnly = _failedOnly ? true : null };

        var reply = await ManageOnly.RunAsync(
            _actions,
            async token =>
            {
                using var client = _sdk();
                return await client.Traces.ReadTracesAsync(query, token).ConfigureAwait(false);
            },
            cancellationToken).ConfigureAwait(true);

        if (generation != _generation)
        {
            return;
        }

        if (reply.Refused)
        {
            Decisions.Clear();
            Showing = null;
            Empty = null;
            Problem = Refused;
            return;
        }

        if (reply.Value is not { } page)
        {
            Problem = Decisions.Count > 0 ? null : "The station could not say what it spent.";
            return;
        }

        var now = DateTimeOffset.Now;
        Decisions.Clear();
        foreach (var placed in TraceWords.Forest(page.Decisions))
        {
            var decision = placed.Decision;
            Decisions.Add(new DecisionRowViewModel(
                decision.Id,
                CheckupWords.Moment(now, decision.At),
                TraceWords.Describe(decision.Kind),
                decision.Kind,
                placed.Depth,
                TraceWords.Cost(decision.Ms),
                decision.Calls,
                decision.Failed));
        }

        Problem = null;
        Showing = Decisions.Count > 0 ? TraceWords.Showing(Decisions.Count, page.Total, page.Spans) : null;
        Empty = Decisions.Count > 0
            ? null
            : _failedOnly
                ? "Nothing has failed. No decision in the kept window made a call that did not answer."
                : "Nothing kept yet. The station keeps a few days of these and writes one as each call ends.";
    }

    partial void OnSelectedChanged(DecisionRowViewModel? oldValue, DecisionRowViewModel? newValue)
    {
        if (oldValue is not null)
        {
            oldValue.IsOpen = false;
        }

        if (newValue is not null)
        {
            newValue.IsOpen = true;
            if (!newValue.Read)
            {
                _ = OpenAsync(newValue);
            }
        }
    }

    private async Task OpenAsync(DecisionRowViewModel row)
    {
        var reply = await ManageOnly.RunAsync(
            _actions,
            async token =>
            {
                using var client = _sdk();
                return await client.Traces.ReadTraceAsync(row.Id, token).ConfigureAwait(false);
            },
            CancellationToken.None).ConfigureAwait(true);

        if (reply.Refused)
        {
            row.Problem = Refused;
            return;
        }

        if (reply.Value is not { } trace)
        {
            // It may have rotated out of the kept window between the list and the click.
            row.Problem = "That decision could not be read. It may have rotated out of the kept window.";
            return;
        }

        Fill(row, trace);
    }

    /// <summary>Puts a decision's calls and lineage on its row.</summary>
    public static void Fill(DecisionRowViewModel row, TraceDetail trace)
    {
        ArgumentNullException.ThrowIfNull(row);
        ArgumentNullException.ThrowIfNull(trace);

        row.Spans.Clear();
        foreach (var span in trace.Spans)
        {
            row.Spans.Add(new SpanViewModel(
                TraceWords.Spent(span.Ms),
                span.Outcome == TraceOutcome.Failed,
                span.Op,
                span.Target,
                span.Error,
                TraceWords.Detail(span.Detail)));
        }

        var lines = new List<string>();
        if (trace.Parent is { } parent)
        {
            lines.Add($"Caused by {parent.Kind}.");
        }
        else if (trace.Decision.Parent is not null)
        {
            lines.Add("Caused by a decision the station no longer keeps.");
        }

        if (trace.Caused.Count > 0)
        {
            lines.Add($"Went on to enqueue {string.Join(", ", trace.Caused.Select(child => child.Kind))}.");
        }

        row.Lineage = lines.Count > 0 ? string.Join(" ", lines) : null;
        row.Problem = null;
        row.Read = true;
    }

    private void Refilter(bool failedOnly)
    {
        if (_suppress)
        {
            return;
        }

        _failedOnly = failedOnly;
        Selected = null;
        _ = LoadAsync(CancellationToken.None);
    }
}
