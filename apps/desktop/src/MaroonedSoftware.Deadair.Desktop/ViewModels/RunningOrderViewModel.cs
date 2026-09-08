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
public sealed partial class RunningOrderViewModel : ObservableObject, IAsyncDisposable
{
    private readonly SessionManager _session;
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly IUiDispatcher _dispatcher;

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
        IUiDispatcher dispatcher)
    {
        _session = session;
        _actions = actions;
        _http = http;
        _dispatcher = dispatcher;

        _session.Changed += _ => _dispatcher.Post(ApplySession);
    }

    public ObservableCollection<OrderItemViewModel> Items { get; } = [];

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

    public void Attach(StationUrl station)
    {
        _repository = new OrderRepository(station, _http, _dispatcher);
        _repository.Changed += OnReading;
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
        }
    }

    private void OnReading(Reading<StationOrder> reading)
    {
        if (reading.Value is not { } order)
        {
            return;
        }

        Name = order.Name;
        Brief = order.Brief;
        Host = order.PersonaLabel;
        _items = order.Items;

        Items.Clear();
        foreach (var item in order.Items)
        {
            Items.Add(new OrderItemViewModel(item, MoveTarget.CanMove(order.Items, item.Id)));
        }

        var at = RunsDry.At(order.Items, DateTimeOffset.Now);
        RunsDryLabel = at is { } when
            ? $"Runs dry at about {when.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture)}"
            : "Nothing ahead has a length the station could give.";
        IsShort = RunsDry.IsShort(order.Items);
    }

    [RelayCommand]
    private async Task ShuffleAsync(CancellationToken cancellationToken) =>
        await _actions.RunAsync(token => _repository!.ShuffleAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

    [RelayCommand]
    private async Task ExtendAsync(CancellationToken cancellationToken)
    {
        // Answers 202 and nothing else, so there is no order to redraw from — the repository looks
        // again over the next few seconds instead.
        await _actions.RunAsync<object>(
            async token =>
            {
                await _repository!.ExtendAsync(token).ConfigureAwait(false);
                return new object();
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);
    }

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

    public async ValueTask DisposeAsync()
    {
        _lease?.Dispose();

        if (_repository is not null)
        {
            await _repository.DisposeAsync().ConfigureAwait(false);
        }
    }
}
