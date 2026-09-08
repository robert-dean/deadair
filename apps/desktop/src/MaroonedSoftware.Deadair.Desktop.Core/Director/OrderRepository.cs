using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Core.Director;

/// <summary>
/// The running order, and the operator's edits to it.
/// </summary>
/// <remarks>
/// <para>
/// Every edit answers with the order it produced, so the list redraws from the answer rather than
/// waiting for the next poll — the same reason the transport does.
/// </para>
/// <para>
/// Extend and replan are the exception: they answer 202 and nothing else, because the work is a job.
/// Those are followed by re-reads at widening intervals, because there is no other way to find out
/// when the new items exist.
/// </para>
/// </remarks>
public sealed class OrderRepository : IAsyncDisposable
{
    /// <summary>Slower than the transport: an order changes at a record boundary, not on a tick.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);

    private static readonly TimeSpan[] AfterAJob =
    [
        TimeSpan.FromMilliseconds(1500),
        TimeSpan.FromMilliseconds(4000),
        TimeSpan.FromMilliseconds(8000),
    ];

    private readonly StationUrl _station;
    private readonly HttpClient _http;
    private readonly IUiDispatcher _dispatcher;
    private readonly Poller<StationOrder> _poller;

    public OrderRepository(
        StationUrl station,
        HttpClient http,
        IUiDispatcher? dispatcher = null,
        TimeProvider? time = null)
    {
        ArgumentNullException.ThrowIfNull(http);

        _station = station;
        _http = http;
        _dispatcher = dispatcher ?? ImmediateUiDispatcher.Instance;

        _poller = new Poller<StationOrder>(
            async cancellationToken =>
            {
                using var sdk = Sdk();
                return await sdk.Director.GetTheRunningOrderAsync(cancellationToken).ConfigureAwait(false);
            },
            Interval,
            dispatcher,
            time);

        _poller.Changed += reading => Changed?.Invoke(reading);
    }

    public Reading<StationOrder> Current => _poller.Current;

    public event Action<Reading<StationOrder>>? Changed;

    public IDisposable Subscribe() => _poller.Subscribe();

    public void Kick() => _poller.Kick();

    public Task<StationOrder> ShuffleAsync(CancellationToken cancellationToken = default) =>
        EditAsync((sdk, token) => sdk.Director.ShuffleTheRunningOrderAsync(token), cancellationToken);

    public Task<StationOrder> MoveAsync(string itemId, int toIndex, CancellationToken cancellationToken = default) =>
        EditAsync(
            (sdk, token) => sdk.Director.MoveARunningOrderItemAsync(itemId, new MoveStationItemInput { ToIndex = toIndex }, token),
            cancellationToken);

    /// <remarks>
    /// A record is spliced out and can be put back; a SEGMENT is marked removed and cannot. That is
    /// the station's rule and the difference is why the undo offered above this is only offered for
    /// one of them.
    /// </remarks>
    public Task<StationOrder> RemoveAsync(string itemId, CancellationToken cancellationToken = default) =>
        EditAsync((sdk, token) => sdk.Director.RemoveARunningOrderItemAsync(itemId, token), cancellationToken);

    /// <summary>
    /// Puts a record back where it was, which is the undo half of a drop.
    /// </summary>
    /// <remarks>
    /// A <see cref="Guid"/> rather than the item's own <c>TrackId</c>, which the contract types as a
    /// string because it is absent on a segment and on a record the catalog has never seen. Undo is
    /// therefore only offered for an item whose id parses, which is the same set of items the station
    /// would accept back.
    /// </remarks>
    public Task<StationOrder> AddTrackAsync(Guid trackId, int? atIndex, CancellationToken cancellationToken = default) =>
        EditAsync(
            (sdk, token) => sdk.Director.AddARecordToTheRunningOrderAsync(
                new AddStationTrackInput { TrackId = trackId, AtIndex = atIndex }, token),
            cancellationToken);

    /// <summary>Asks for more. Answers at once; the items appear later.</summary>
    public async Task ExtendAsync(CancellationToken cancellationToken = default)
    {
        using var sdk = Sdk();
        await sdk.Director.ExtendTheRunningOrderAsync(new ExtendStationInput(), cancellationToken).ConfigureAwait(false);

        // A 202 and no order. The only way to know when the refill landed is to look again, so this
        // looks three times over the next eight seconds and then goes back to the ordinary interval.
        FollowJob();
    }

    private async Task<StationOrder> EditAsync(
        Func<DeadairSdk, CancellationToken, Task<StationOrder>> call,
        CancellationToken cancellationToken)
    {
        using var sdk = Sdk();
        var order = await call(sdk, cancellationToken).ConfigureAwait(false);

        _dispatcher.Post(() => Changed?.Invoke(Reading<StationOrder>.Good(order, DateTimeOffset.UtcNow)));
        return order;
    }

    private void FollowJob()
    {
        foreach (var delay in AfterAJob)
        {
            _ = Task.Delay(delay).ContinueWith(_ => _poller.Kick(), TaskScheduler.Default);
        }
    }

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = _http,
    });

    public ValueTask DisposeAsync() => _poller.DisposeAsync();
}
