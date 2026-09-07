using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playout;

/// <summary>
/// The station's transport, as one reading, and the verbs that change it.
/// </summary>
/// <remarks>
/// <para>
/// Every transport call answers with the <c>PlayoutStatus</c> it produced, so the desk redraws from
/// the answer instead of waiting for the next poll. Without that a skip feels like it did not take:
/// the record changes in the audio a second before the screen admits it.
/// </para>
/// <para>
/// The station also settles for a moment afterwards, so the reading is re-taken at a few short
/// intervals rather than once. Those numbers come from the web console, where they were arrived at by
/// watching a real desk.
/// </para>
/// </remarks>
public sealed class PlayoutRepository : IAsyncDisposable
{
    /// <summary>Matches the station's own reconcile tick: reading faster would tell you nothing newer.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);

    private static readonly TimeSpan[] Settling =
    [
        TimeSpan.FromMilliseconds(400),
        TimeSpan.FromMilliseconds(1000),
        TimeSpan.FromMilliseconds(2500),
    ];

    private readonly StationUrl _station;
    private readonly HttpClient _http;
    private readonly IUiDispatcher _dispatcher;
    private readonly Poller<PlayoutStatus> _poller;

    public PlayoutRepository(
        StationUrl station,
        HttpClient http,
        IUiDispatcher? dispatcher = null,
        TimeProvider? time = null)
    {
        ArgumentNullException.ThrowIfNull(http);

        _station = station;
        _http = http;
        _dispatcher = dispatcher ?? ImmediateUiDispatcher.Instance;

        _poller = new Poller<PlayoutStatus>(
            async cancellationToken =>
            {
                using var sdk = Sdk();
                return await sdk.Playout.GetPlayoutStatusAsync(cancellationToken).ConfigureAwait(false);
            },
            Interval,
            dispatcher,
            time);

        _poller.Changed += reading => Changed?.Invoke(reading);
    }

    public Reading<PlayoutStatus> Current => _poller.Current;

    public event Action<Reading<PlayoutStatus>>? Changed;

    public IDisposable Subscribe() => _poller.Subscribe();

    public void Kick() => _poller.Kick();

    public Task<PlayoutStatus> SkipAsync(CancellationToken cancellationToken = default) =>
        TransportAsync((sdk, token) => sdk.Playout.SkipTheCurrentItemAsync(token), cancellationToken);

    /// <remarks>Takes the station off air and LEAVES the running order in place, so start resumes it.</remarks>
    public Task<PlayoutStatus> StopAsync(CancellationToken cancellationToken = default) =>
        TransportAsync((sdk, token) => sdk.Playout.StopPlayoutAsync(token), cancellationToken);

    /// <remarks>409 when there is nothing to resume, which is an outcome rather than a fault.</remarks>
    public Task<PlayoutStatus> StartAsync(CancellationToken cancellationToken = default) =>
        TransportAsync((sdk, token) => sdk.Playout.StartPlayoutAsync(token), cancellationToken);

    private async Task<PlayoutStatus> TransportAsync(
        Func<DeadairSdk, CancellationToken, Task<PlayoutStatus>> call,
        CancellationToken cancellationToken)
    {
        using var sdk = Sdk();
        var status = await call(sdk, cancellationToken).ConfigureAwait(false);

        // The answer IS the new reading. Writing it in is what makes a skip feel immediate.
        _dispatcher.Post(() => Changed?.Invoke(Reading<PlayoutStatus>.Good(status, DateTimeOffset.UtcNow)));

        Follow();
        return status;
    }

    /// <summary>
    /// Re-reads while the station settles.
    /// </summary>
    /// <remarks>
    /// The status a transport call answers with is true at the moment it was made, and the boundary it
    /// caused takes a moment to finish. Three short re-reads cover that without polling faster for
    /// the rest of the session.
    /// </remarks>
    private void Follow()
    {
        foreach (var delay in Settling)
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
