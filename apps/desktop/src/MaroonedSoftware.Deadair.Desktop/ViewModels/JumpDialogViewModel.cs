using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One row of the palette: a place, or a record, act or character found by searching.</summary>
/// <param name="Label">What it is called.</param>
/// <param name="Detail">The line beside it: the page a tab is on, a record's artist.</param>
/// <param name="Go">Takes the app there.</param>
public sealed record JumpTarget(string Label, string Detail, Action Go);

/// <summary>
/// The jump-to palette (Command-K): a box, and every place and thing that matches it.
/// </summary>
/// <remarks>
/// A dialog rather than a page, so it opens over wherever somebody is and closes there if they change
/// their mind. Return opens the chosen row, or the first one when nothing has been chosen.
/// </remarks>
public sealed partial class JumpDialogViewModel : DialogViewModel
{
    private readonly IReadOnlyList<(JumpPage Page, JumpTarget Target)> _pages;
    private readonly Func<string, CancellationToken, Task<IReadOnlyList<JumpTarget>>> _search;
    private readonly TimeProvider _time;
    private CancellationTokenSource? _pending;

    public JumpDialogViewModel(
        IReadOnlyList<(JumpPage Page, JumpTarget Target)> pages,
        Func<string, CancellationToken, Task<IReadOnlyList<JumpTarget>>> search,
        TimeProvider? time = null)
    {
        _pages = pages;
        _search = search;
        _time = time ?? TimeProvider.System;
        Show([]);
    }

    public override string Title => "Jump to";

    public override string AcceptLabel => "Open";

    public override bool CanAccept => Chosen is not null || Results.Count > 0;

    public ObservableCollection<JumpTarget> Results { get; } = [];

    [ObservableProperty]
    private string _query = string.Empty;

    [ObservableProperty]
    private JumpTarget? _chosen;

    /// <summary>Said while the station is being asked, so an empty list is not read as "nothing".</summary>
    [ObservableProperty]
    private string? _status;

    partial void OnChosenChanged(JumpTarget? value) => Revalidate();

    partial void OnQueryChanged(string value)
    {
        Show([]);

        _pending?.Cancel();
        _pending = null;
        Status = null;

        if (!JumpTo.Searches(value))
        {
            return;
        }

        var cancel = new CancellationTokenSource();
        _pending = cancel;
        Status = "Looking…";
        _ = SearchAsync(value, cancel.Token);
    }

    private async Task SearchAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(JumpTo.Settle, _time, cancellationToken).ConfigureAwait(true);
            var found = await _search(query.Trim(), cancellationToken).ConfigureAwait(true);

            if (!cancellationToken.IsCancellationRequested)
            {
                Show(found);
                Status = found.Count == 0 && Results.Count == 0 ? "Nothing here by that name." : null;
            }
        }
        catch (OperationCanceledException)
        {
            // Typing moved on, and the newer query is the one that answers.
        }
    }

    /// <summary>What the station found first, then the places, as the web lists them.</summary>
    private void Show(IReadOnlyList<JumpTarget> found)
    {
        Results.Clear();
        foreach (var target in found)
        {
            Results.Add(target);
        }

        foreach (var page in JumpTo.Filter(_pages.Select(pair => pair.Page), Query))
        {
            Results.Add(_pages.First(pair => ReferenceEquals(pair.Page, page)).Target);
        }

        Chosen = null;
        Revalidate();
    }

    public override Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var target = Chosen ?? Results.FirstOrDefault();
        if (target is null)
        {
            return Task.FromResult(false);
        }

        _pending?.Cancel();
        target.Go();
        return Task.FromResult(true);
    }
}
