using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One record in the library.</summary>
public sealed class TrackRowViewModel(
    TrackRow row,
    Uri? artworkUrl,
    RatingViewModel rating,
    IReadOnlyList<RepairChoiceViewModel> repairs)
{
    public Guid Id { get; } = row.Id;

    public string Title { get; } = row.Title;

    public string Artists { get; } = row.Artists;

    public Guid ArtistId { get; } = row.ArtistId;

    public Guid? AlbumId { get; } = row.AlbumId;

    public string? Album { get; } = row.AlbumName;

    /// <summary>Who, and on what, as one line under the title.</summary>
    public string Credit { get; } = row.AlbumName is { Length: > 0 } album ? $"{row.Artists} · {album}" : row.Artists;

    public string Length { get; } = CatalogPaging.Length(row.DurationMs);

    public string? Year { get; } = row.Year?.ToString(CultureInfo.InvariantCulture);

    public Uri? ArtworkUrl { get; } = artworkUrl;

    /// <summary>
    /// What the station has of the record, as the words that are true and nothing for the rest: an
    /// absent word already says "not yet" without a placeholder to parse.
    /// </summary>
    public string Marks { get; } = string.Join(
        " · ",
        new[] { (row.HasAudio, "held"), (row.Measured, "measured"), (row.Enriched, "described") }
            .Where(mark => mark.Item1)
            .Select(mark => mark.Item2));

    public RatingViewModel Rating { get; } = rating;

    public IReadOnlyList<RepairChoiceViewModel> Repairs { get; } = repairs;

    /// <summary>The square drawn until, or instead of, a cover.</summary>
    public string Initial => Title.Length == 0 ? "?" : char.ToUpperInvariant(Title[0]).ToString();
}

/// <summary>One chip of the state filter.</summary>
public sealed partial class StateChipViewModel(TrackStateFilter filter) : ObservableObject
{
    public TrackState State { get; } = filter.State;

    public string Help { get; } = filter.Help;

    [ObservableProperty]
    private string _text = filter.Label;

    [ObservableProperty]
    private bool _isChosen;

    /// <summary>
    /// A chip with nothing behind it is drawn and disabled rather than hidden: zero benched records is
    /// a fact worth seeing, and a strip that changed shape as the numbers moved would be unreadable.
    /// </summary>
    [ObservableProperty]
    private bool _isEnabled = true;
}

/// <summary>
/// Every record the station has, flat, with what it holds of each and what can be done about one that
/// will not play.
/// </summary>
/// <remarks>
/// The flat list rather than a drill-down, because the question an operator arrives with is "do we have
/// this song?", and a drill-down cannot answer it without already knowing whose it is.
/// </remarks>
public sealed partial class RecordsViewModel : PagedTabViewModel
{
    private readonly TrackRepairer _repairer;
    private readonly IDialogs _dialogs;

    public RecordsViewModel(OperatorActions actions, HttpClient http, IDialogs dialogs)
        : base(actions, http)
    {
        _dialogs = dialogs;
        _repairer = new TrackRepairer(actions, dialogs, Sdk);
        Chips = [.. TrackStates.All.Select(filter => new StateChipViewModel(filter))];
        _sort = CatalogSorts.Tracks[0];
    }

    public ObservableCollection<TrackRowViewModel> Tracks { get; } = [];

    public IReadOnlyList<StateChipViewModel> Chips { get; }

    public IReadOnlyList<SortChoice<TrackSort>> Sorts { get; } = CatalogSorts.Tracks;

    [ObservableProperty]
    private SortChoice<TrackSort> _sort;

    [ObservableProperty]
    private bool _descending;

    /// <summary>The state the list is narrowed to, or null for every record.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(BulkRepair), nameof(ShowsBulk))]
    private TrackState? _state;

    /// <summary>How much of the library can go out right now, once the station has said.</summary>
    [ObservableProperty]
    private string? _ready;

    /// <summary>Why the list is empty, when it is.</summary>
    [ObservableProperty]
    private string? _empty;

    /// <summary>What the list-wide repair did, which outlives the rows it emptied.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowsBulk))]
    private string? _bulkOutcome;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowsBulk))]
    private string? _bulkLabel;

    /// <summary>The repair the whole page gets, which exists only for the two fault states.</summary>
    public TrackRepair? BulkRepair => TrackRepairs.ForState(State);

    /// <summary>
    /// Drawn while there are rows to act on, and afterwards while there is an outcome: a press that
    /// works empties the list it was pressed on, and the answer must not go with the last row.
    /// </summary>
    public bool ShowsBulk => BulkRepair is not null && (BulkLabel is not null || BulkOutcome is not null);

    partial void OnSortChanged(SortChoice<TrackSort> value) => Restart();

    partial void OnDescendingChanged(bool value) => Restart();

    partial void OnStateChanged(TrackState? value)
    {
        BulkOutcome = null;
        foreach (var chip in Chips)
        {
            chip.IsChosen = chip.State == value;
        }

        Restart();
    }

    /// <summary>Narrows the list to a state, or widens it again when the chosen chip is pressed.</summary>
    [RelayCommand]
    private void Filter(StateChipViewModel chip)
    {
        ArgumentNullException.ThrowIfNull(chip);
        State = State == chip.State ? null : chip.State;
    }

    [RelayCommand]
    private void TurnSort() => Descending = !Descending;

    /// <summary>The fault state's repair, over exactly the rows on screen.</summary>
    /// <remarks>
    /// The page and not every record in the state: the page is what the operator is looking at, and a
    /// button that quietly reached past it would be acting on records they have not seen.
    /// </remarks>
    [RelayCommand]
    private async Task RepairPageAsync(CancellationToken cancellationToken)
    {
        if (BulkRepair is not { } repair || Tracks.Count == 0)
        {
            return;
        }

        var ids = Tracks.Select(row => row.Id).ToList();
        var words = TrackRepairs.Bulk(repair, ids.Count);
        if (!await _dialogs.ConfirmAsync(words.Question, words.Consequence, words.Verb, destructive: false).ConfigureAwait(true))
        {
            return;
        }

        Busy = true;
        try
        {
            var (done, refused) = await _repairer.RepairAllAsync(ids, repair, cancellationToken).ConfigureAwait(true);
            await RefreshCommand.ExecuteAsync(null).ConfigureAwait(true);
            BulkOutcome = TrackRepairs.Outcome(done, refused);
        }
        finally
        {
            Busy = false;
        }
    }

    protected override async Task<long?> ReadPageAsync(CancellationToken cancellationToken)
    {
        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.ListTracksAsync(
                    new TrackQueryInput
                    {
                        Page = Page,
                        PageSize = PageSize,
                        Search = Term,
                        SortBy = Sort.Key,
                        Sort = Descending ? PaginationSort.Desc : PaginationSort.Asc,
                        State = State,
                    },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return null;
        }

        Present(page);
        return page.Meta.Total;
    }

    /// <summary>Draws a page the station answered with. Public so a frame can be posed from one.</summary>
    public void Present(TrackPage page)
    {
        ArgumentNullException.ThrowIfNull(page);

        Tracks.Clear();
        foreach (var row in page.Data)
        {
            Tracks.Add(Row(row));
        }

        Ready = TrackStates.Ready(page.States);
        foreach (var chip in Chips)
        {
            var count = TrackStates.Count(chip.State, page.States);
            var filter = TrackStates.All.First(each => each.State == chip.State);
            chip.Text = $"{count.ToString("N0", CultureInfo.CurrentCulture)} {filter.Label}";
            chip.IsEnabled = count > 0 || chip.IsChosen;
        }

        Empty = Tracks.Count == 0 ? TrackStates.NothingHere(Search, State, page.States.Total) : null;
        BulkLabel = BulkRepair is { } repair && Tracks.Count > 0 ? TrackRepairs.BulkLabel(repair, Tracks.Count) : null;
    }

    private TrackRowViewModel Row(TrackRow row)
    {
        var rating = new RatingViewModel(row.Rating, row.Title, async (chosen, cancellationToken) =>
        {
            var track = await Actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();
                    return await sdk.Catalog.RateTrackAsync(row.Id, new RateInput { Rating = chosen }, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);
            return track?.Rating;
        });

        return new TrackRowViewModel(
            row,
            Station.ArtUrl(row.AlbumImageUrl),
            rating,
            _repairer.Menu(row.Id, detail =>
            {
                Notice = $"{row.Title}: {detail}";

                // The row's marks are what the repair changed, so the page is read again.
                _ = RefreshCommand.ExecuteAsync(null);
            }));
    }

    public override void Reset()
    {
        base.Reset();
        Tracks.Clear();
        Ready = null;
        Empty = null;
        BulkOutcome = null;
        BulkLabel = null;

        // Straight to the fields: the change handlers read the list again, and a reset is not a read.
#pragma warning disable MVVMTK0034
        _state = null;
        _descending = false;
        _sort = CatalogSorts.Tracks[0];
#pragma warning restore MVVMTK0034
        OnPropertyChanged(nameof(State));
        OnPropertyChanged(nameof(Descending));
        OnPropertyChanged(nameof(Sort));
        OnPropertyChanged(nameof(BulkRepair));
        OnPropertyChanged(nameof(ShowsBulk));
        foreach (var chip in Chips)
        {
            chip.IsChosen = false;
        }
    }
}
