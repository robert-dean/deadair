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
/// <para>
/// <b>The station's air rides the same poll.</b> Who is driving, the hold and the air mode are read
/// on every tick of the order, straight after it, rather than on a timer of their own. The web console
/// polls both at five seconds, and a second loop here would be a second lease, a second backoff and a
/// second thing to detach on a change of station for a reading that changes at the same boundaries
/// the order does. A failed air read keeps the last one: it never fails the order's tick.
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
                var order = await sdk.Director.GetTheRunningOrderAsync(cancellationToken).ConfigureAwait(false);
                await ReadAirAsync(sdk, cancellationToken).ConfigureAwait(false);
                return order;
            },
            Interval,
            dispatcher,
            time);

        _poller.Changed += reading => Changed?.Invoke(reading);
    }

    public Reading<StationOrder> Current => _poller.Current;

    public event Action<Reading<StationOrder>>? Changed;

    /// <summary>The last air reading, or null before the first has arrived.</summary>
    public StationAir? Air { get; private set; }

    /// <summary>Raised on the UI dispatcher with every air reading, polled or answered by a change.</summary>
    public event Action<StationAir>? AirChanged;

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

    /// <summary>
    /// Jumps the station straight to a record, passing over everything in front of it and cutting
    /// what is on air.
    /// </summary>
    /// <remarks>
    /// Offered on a record the player already holds as well as a planned one, unlike a move: reaching
    /// past the player's queue is the whole point. The station refuses a segment with a 422, because a
    /// break's words are about the records around it.
    /// </remarks>
    public Task<StationOrder> SkipToAsync(string itemId, CancellationToken cancellationToken = default) =>
        EditAsync((sdk, token) => sdk.Director.SkipToARunningOrderItemAsync(itemId, token), cancellationToken);

    /// <summary>Changes who presents the broadcast on air. Null hands it back to the station's own host.</summary>
    public Task<StationOrder> RecastAsync(string? personaId, CancellationToken cancellationToken = default) =>
        EditAsync(
            (sdk, token) => sdk.Director.RecastTheBroadcastAsync(new SetStationHostInput { PersonaId = personaId }, token),
            cancellationToken);

    /// <summary>What puts the station on air: somebody listening, or always.</summary>
    public Task<StationAir> SetAirModeAsync(AirMode mode, CancellationToken cancellationToken = default) =>
        AirAsync((sdk, token) => sdk.Director.SetTheAirModeAsync(new SetStationAirInput { AirMode = mode }, token), cancellationToken);

    /// <summary>Keeps the schedule off this broadcast, for so many minutes or (null) until released.</summary>
    public Task<StationAir> HoldAsync(long? minutes, CancellationToken cancellationToken = default) =>
        AirAsync(
            (sdk, token) => sdk.Director.HoldTheStationAgainstTheScheduleAsync(new HoldStationInput { Minutes = minutes }, token),
            cancellationToken);

    /// <summary>Hands the broadcast back to the schedule at its next block.</summary>
    public Task<StationAir> ReleaseAsync(CancellationToken cancellationToken = default) =>
        AirAsync((sdk, token) => sdk.Director.ReleaseTheStationToTheScheduleAsync(token), cancellationToken);

    /// <summary>
    /// Starts a new broadcast. What is playing stops and everything still to come is dropped.
    /// </summary>
    /// <remarks>
    /// It answers with the air and not the order, and the new order is built by the station after it
    /// answers, so it is followed the way a job is.
    /// </remarks>
    public async Task<StationAir> PutOnAirAsync(PutOnAirInput input, CancellationToken cancellationToken = default)
    {
        var air = await AirAsync((sdk, token) => sdk.Director.PutTheStationOnAirAsync(input, token), cancellationToken)
            .ConfigureAwait(false);
        FollowJob();
        return air;
    }

    /// <summary>Regenerates what is still to come, keeping this show. Answers at once; the items appear later.</summary>
    public async Task ReplanAsync(ReplanStationInput input, CancellationToken cancellationToken = default)
    {
        using var sdk = Sdk();
        await sdk.Director.ReplanTheRunningOrderAsync(input, cancellationToken).ConfigureAwait(false);
        FollowJob();
    }

    private async Task<StationAir> AirAsync(
        Func<DeadairSdk, CancellationToken, Task<StationAir>> call,
        CancellationToken cancellationToken)
    {
        using var sdk = Sdk();
        var air = await call(sdk, cancellationToken).ConfigureAwait(false);
        PublishAir(air);
        return air;
    }

    /// <remarks>
    /// Swallows a failure rather than failing the order's tick: the order is the reading the desk
    /// cannot do without, and the air answering badly once is a stale badge rather than a broken desk.
    /// </remarks>
    private async Task ReadAirAsync(DeadairSdk sdk, CancellationToken cancellationToken)
    {
        try
        {
            PublishAir(await sdk.Director.GetStationAirAsync(cancellationToken).ConfigureAwait(false));
        }
        catch (HttpRequestException)
        {
            // Kept: the last reading stands until one arrives. A refusal and a dropped connection are
            // both this, since the SDK's own exception is one.
        }
    }

    private void PublishAir(StationAir air)
    {
        Air = air;
        _dispatcher.Post(() => AirChanged?.Invoke(air));
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
