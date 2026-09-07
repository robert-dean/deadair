using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Sdk;
using NowPlayingReading = MaroonedSoftware.Deadair.Sdk.Models.NowPlaying;

namespace MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

/// <summary>
/// What is on air, asked of the station every few seconds.
/// </summary>
/// <remarks>
/// <para>
/// <c>GET /nowplaying</c> is anonymous and answered out of the station's memory, so polling it this
/// often is cheap and is what every other client does. There is no realtime channel to use instead:
/// the station has no websocket and no server-sent events.
/// </para>
/// <para>
/// It carries the mount list as well as the track, which is why the listener half of the app needs
/// nothing else — and why a format picker must read it rather than trying the mounts, since a
/// connection of any length registers an audience for five minutes.
/// </para>
/// </remarks>
public sealed class NowPlayingRepository : IAsyncDisposable
{
    /// <summary>
    /// Three seconds, matching the Android listener.
    /// </summary>
    /// <remarks>
    /// The station's own boundaries are the thing being tracked, and a record change that takes six
    /// seconds to appear on screen while the audio has already moved on reads as a broken app.
    /// </remarks>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(3);

    private readonly Poller<NowPlayingReading> _poller;

    public NowPlayingRepository(
        StationUrl station,
        HttpClient http,
        IUiDispatcher? dispatcher = null,
        TimeProvider? time = null)
    {
        ArgumentNullException.ThrowIfNull(http);

        Station = station;

        _poller = new Poller<NowPlayingReading>(
            async cancellationToken =>
            {
                // Built per read rather than held: the SDK is a thin wrapper over the shared client,
                // which is the expensive part and is not rebuilt.
                using var sdk = new DeadairSdk(new Sdk.Runtime.SdkOptions
                {
                    BaseUrl = station.ApiBase,
                    HttpClient = http,
                });

                return await sdk.Nowplaying.GetNowPlayingAsync(cancellationToken).ConfigureAwait(false);
            },
            Interval,
            dispatcher,
            time,

            // A station that has gone away is polled once a minute rather than every three seconds.
            // It comes back on its own, and a kick brings it back at once when somebody asks.
            slowest: TimeSpan.FromSeconds(60));

        _poller.Changed += reading => Changed?.Invoke(reading);
    }

    public StationUrl Station { get; }

    public Reading<NowPlayingReading> Current => _poller.Current;

    public event Action<Reading<NowPlayingReading>>? Changed;

    /// <summary>Starts polling, and keeps it running until the lease is disposed.</summary>
    public IDisposable Subscribe() => _poller.Subscribe();

    /// <summary>Asks now: somebody pressed retry, or play, and expects the screen to catch up.</summary>
    public void Kick() => _poller.Kick();

    public ValueTask DisposeAsync() => _poller.DisposeAsync();
}
