using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// What the station is going to play, and the operator's edits to it.
/// </summary>
/// <remarks>
/// It also owns the station's air (<see cref="Air"/>) and what needs the operator
/// (<see cref="NeedsYou"/>), because both are read on the order's own poll: the one reading that
/// runs, for an operator, on every page.
/// </remarks>
public sealed partial class RunningOrderViewModel : ObservableObject, IAsyncDisposable
{
    private readonly SessionManager _session;
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly IUiDispatcher _dispatcher;
    private readonly IDialogs _dialogs;

    /// <summary>Every how many order readings the attention list is read again: fifteen seconds.</summary>
    private const int AttentionEvery = 3;

    /// <summary>Good order readings since the operator's session began, which paces the attention list.</summary>
    private int _readings;

    private OrderRepository? _repository;
    private IDisposable? _lease;
    private List<StationOrderItem> _items = [];

    private Guid? _droppedTrack;
    private int? _droppedAt;
    private string? _droppedTitle;

    public RunningOrderViewModel(
        SessionManager session,
        OperatorActions actions,
        HttpClient http,
        IUiDispatcher dispatcher,
        IDialogs dialogs,
        NavigationViewModel navigation)
    {
        _session = session;
        _actions = actions;
        _http = http;
        _dispatcher = dispatcher;
        _dialogs = dialogs;
        Air = new StationAirViewModel(actions, dialogs, http);
        NeedsYou = new NeedsYouViewModel(http, navigation);

        _session.Changed += _ => _dispatcher.Post(ApplySession);
    }

    public ObservableCollection<OrderItemViewModel> Items { get; } = [];

    /// <summary>The station's air on the desk: who is driving, the hold, the air mode, the host and the plan.</summary>
    public StationAirViewModel Air { get; }

    /// <summary>What the station says needs somebody: the desk's list and the sidebar's badges.</summary>
    public NeedsYouViewModel NeedsYou { get; }

    [ObservableProperty]
    private bool _isOperator;

    [ObservableProperty]
    private string _name = string.Empty;

    [ObservableProperty]
    private string? _brief;

    [ObservableProperty]
    private string? _host;

    [ObservableProperty]
    private string _runsDryLabel = string.Empty;

    [ObservableProperty]
    private bool _isShort;

    [ObservableProperty]
    private bool _canUndo;

    [ObservableProperty]
    private string? _undoLabel;

    /// <summary>The station the order is read from, which each row's cover is resolved against.</summary>
    private StationUrl _station;

    public void Attach(StationUrl station)
    {
        _station = station;
        _repository = new OrderRepository(station, _http, _dispatcher);
        _repository.Changed += OnReading;
        _repository.AirChanged += OnAir;
        Air.Attach(_repository, station);
        NeedsYou.Attach(station);
        ApplySession();
    }

    private void ApplySession()
    {
        var operating = _session.State is SessionState.SignedIn { IsOperator: true };
        IsOperator = operating;

        if (operating)
        {
            _lease ??= _repository?.Subscribe();
        }
        else
        {
            _lease?.Dispose();
            _lease = null;
            Items.Clear();

            // What the air said belongs to an operator's session. Put back when the next one's
            // first reading arrives.
            if (_repository is not null)
            {
                Air.Reset();
                Air.Attach(_repository, _station);
            }

            NeedsYou.Reset();
            _readings = 0;
        }
    }

    private void OnReading(Reading<StationOrder> reading)
    {
        // The poll lingers a few seconds past its last lease, so a reading can land after the operator
        // has signed out; it would put their order, air and attention back on a listener's screen.
        if (reading.Value is not { } order || !IsOperator)
        {
            return;
        }

        // The first reading of a session asks at once, so the badges are up as the operator arrives.
        if (_readings++ % AttentionEvery == 0)
        {
            _ = NeedsYou.RefreshAsync();
        }

        Name = order.Name;
        Brief = order.Brief;
        Air.ApplyOrder(order);
        Host = order.PersonaLabel;
        _items = order.Items;

        Items.Clear();
        foreach (var item in order.Items)
        {
            Items.Add(new OrderItemViewModel(item, MoveTarget.CanMove(order.Items, item.Id), _station.ArtUrl(item.ArtworkUrl)));
        }

        var at = RunsDry.At(order.Items, DateTimeOffset.Now);
        RunsDryLabel = at is { } when
            ? $"Runs dry at about {when.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture)}"
            : "Nothing ahead has a length the station could give.";
        IsShort = RunsDry.IsShort(order.Items);
    }

    /// <remarks>Guarded for the reason the order's reading is: the poll outlives a sign-out by a few seconds.</remarks>
    private void OnAir(StationAir air)
    {
        if (IsOperator)
        {
            Air.ApplyAir(air);
        }
    }

    [RelayCommand]
    private async Task ShuffleAsync(CancellationToken cancellationToken) =>
        await _actions.RunAsync(token => _repository!.ShuffleAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

    [RelayCommand]
    private Task MoveToTopAsync(OrderItemViewModel item)
    {
        ArgumentNullException.ThrowIfNull(item);
        return MoveAsync(item, MoveTarget.ToTop(_items, item.Id));
    }

    [RelayCommand]
    private Task MoveUpAsync(OrderItemViewModel item)
    {
        ArgumentNullException.ThrowIfNull(item);
        return MoveAsync(item, MoveTarget.Up(_items, item.Id));
    }

    [RelayCommand]
    private Task MoveDownAsync(OrderItemViewModel item)
    {
        ArgumentNullException.ThrowIfNull(item);
        return MoveAsync(item, MoveTarget.Down(_items, item.Id));
    }

    private async Task MoveAsync(OrderItemViewModel item, int? toIndex)
    {
        ArgumentNullException.ThrowIfNull(item);

        // Nothing to do rather than a request the station will refuse: it rejects a move into a
        // position the player already holds instead of clamping it, so the floor is worked out here.
        if (toIndex is not { } index)
        {
            return;
        }

        await _actions.RunAsync(token => _repository!.MoveAsync(item.Id, index, token)).ConfigureAwait(true);
    }

    /// <summary>
    /// Jumps the station straight to a record, asked first: everything in front of it is passed over
    /// and what is on air is cut, which every listener hears at once.
    /// </summary>
    [RelayCommand]
    private async Task SkipToAsync(OrderItemViewModel item)
    {
        ArgumentNullException.ThrowIfNull(item);

        if (!item.CanSkipTo || _repository is not { } repository)
        {
            return;
        }

        var asked = await _dialogs.ConfirmAsync(
            $"Skip to {item.Title}?",
            "Everything in front of it is passed over and the record on air is cut. Listeners hear it at once.",
            "Skip to it").ConfigureAwait(true);

        if (asked)
        {
            // The same race as a move's: the record can reach the air, or pass it, between the row
            // being drawn and the click. The station says which, and that sentence is shown.
            await _actions.RunAsync(token => repository.SkipToAsync(item.Id, token)).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private async Task DropAsync(OrderItemViewModel item)
    {
        ArgumentNullException.ThrowIfNull(item);

        var index = IndexOf(item.Id);
        var order = await _actions.RunAsync(token => _repository!.RemoveAsync(item.Id, token)).ConfigureAwait(true);

        if (order is null)
        {
            return;
        }

        // Only a record can come back. A segment is marked removed by the station and stays that way,
        // so offering an undo for one would be offering something that cannot happen.
        if (item is { CanUndoDrop: true, TrackId: { } trackId })
        {
            _droppedTrack = trackId;
            _droppedAt = index;
            _droppedTitle = item.Title;
            UndoLabel = $"Dropped {item.Title}";
            CanUndo = true;
        }
    }

    [RelayCommand]
    private async Task UndoDropAsync()
    {
        if (_droppedTrack is not { } trackId)
        {
            return;
        }

        CanUndo = false;
        _droppedTrack = null;

        await _actions.RunAsync(token => _repository!.AddTrackAsync(trackId, _droppedAt, token)).ConfigureAwait(true);
    }

    private int IndexOf(string itemId)
    {
        for (var index = 0; index < _items.Count; index++)
        {
            if (string.Equals(_items[index].Id, itemId, StringComparison.Ordinal))
            {
                return index;
            }
        }

        return 0;
    }

    /// <summary>
    /// Stops reading the running order and forgets it, before the app is pointed at another station.
    /// </summary>
    /// <remarks>The same reason as the transport's: an old repository left polling carries the new station's token.</remarks>
    public async Task DetachAsync()
    {
        _lease?.Dispose();
        _lease = null;

        if (_repository is not null)
        {
            _repository.Changed -= OnReading;
            _repository.AirChanged -= OnAir;
            await _repository.DisposeAsync().ConfigureAwait(true);
            _repository = null;
        }

        Air.Reset();
        NeedsYou.Reset();
        _readings = 0;
        _items = [];
        Items.Clear();
        _droppedTrack = null;
        _droppedAt = null;
        _droppedTitle = null;
        Name = string.Empty;
        Brief = null;
        Host = null;
        RunsDryLabel = string.Empty;
        IsShort = false;
        CanUndo = false;
        UndoLabel = null;
    }

    public async ValueTask DisposeAsync()
    {
        _lease?.Dispose();

        if (_repository is not null)
        {
            await _repository.DisposeAsync().ConfigureAwait(false);
        }
    }
}
