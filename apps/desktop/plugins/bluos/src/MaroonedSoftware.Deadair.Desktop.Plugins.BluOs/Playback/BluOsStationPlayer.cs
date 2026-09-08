using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;

/// <summary>
/// The station, played on a BluOS player somewhere else in the house.
/// </summary>
/// <remarks>
/// <para>
/// The player fetches the audio itself, so nothing here carries a byte of it: this hands over a
/// mount, watches what the device says about it, and reports. <b>The device is a listener to the
/// station in its own right</b>, which is why stopping and disposing both really stop it — one left
/// streaming is an audience the station keeps counting with nothing left to end it.
/// </para>
/// <para>
/// It reports and never recovers. What a phase means and when to try again belong to the host's
/// conductor, the same as for the machine's own player.
/// </para>
/// </remarks>
public sealed class BluOsStationPlayer : IStationPlayer, IVolumeReadback
{
    /// <summary>
    /// How long to poll plainly before settling into a long poll.
    /// </summary>
    /// <remarks>
    /// Warm-up cannot be watched with a long poll: the transition that matters is <c>secs</c>
    /// leaving zero, and the position is deliberately not part of the etag, so the request would sit
    /// there for its whole timeout while the music started. Measured warm-up is about seven seconds;
    /// this is long enough not to care.
    /// </remarks>
    private static readonly TimeSpan FastUntil = TimeSpan.FromSeconds(90);

    /// <summary>The spec's floor for two requests in a row.</summary>
    private static readonly TimeSpan BetweenPolls = TimeSpan.FromSeconds(1);

    /// <summary>How long to wait after a request failed before asking again.</summary>
    private static readonly TimeSpan AfterAFailure = TimeSpan.FromSeconds(2);

    /// <summary>And once it is clearly not answering, how often to check whether it came back.</summary>
    private static readonly TimeSpan WhileUnreachable = TimeSpan.FromSeconds(5);

    /// <summary>
    /// How many failures in a row before saying so.
    /// </summary>
    /// <remarks>
    /// One dropped request is a network, not a fault, and reporting it would step the host's backoff
    /// and interrupt a player that is streaming perfectly well.
    /// </remarks>
    private const int FailuresBeforeSayingSo = 3;

    private readonly BluOsClient _client;
    private readonly BluOsSettings _settings;
    private readonly TimeProvider _clock;
    private readonly IPluginLogger _logger;
    private readonly VolumeCoalescer _volume;
    private readonly Lock _gate = new();

    private CancellationTokenSource? _watching;
    private Task _watcher = Task.CompletedTask;
    private Uri? _mount;
    private int? _level;
    private bool _played;
    private bool _disposed;

    public BluOsStationPlayer(BluOsClient client, BluOsSettings settings, TimeProvider clock, IPluginLogger logger)
    {
        _client = client;
        _settings = settings;
        _clock = clock;
        _logger = logger;
        _volume = new VolumeCoalescer(SendVolumeAsync, logger);
    }

    public PlayerStatus Status { get; private set; } = PlayerStatus.Stopped;

    public event Action<PlayerStatus>? StatusChanged;

    /// <summary>False until the player has said how loud it is.</summary>
    public bool VolumeKnown => _level is not null;

    public event Action? VolumeChanged;

    /// <summary>
    /// 0.0 to 1.0, over the player's own 0 to 100.
    /// </summary>
    /// <remarks>
    /// The getter is the last thing the player said, which is the only honest answer: this volume
    /// belongs to the device and a hand on its front panel can move it. Setting is asynchronous and
    /// coalesced, because the seam is a property and a slider is dozens of values a second.
    /// </remarks>
    public double Volume
    {
        get => (_level ?? 0) / 100.0;
        set => _volume.Want((int)Math.Round(Math.Clamp(value, 0, 1) * 100));
    }

    public async Task PlayAsync(Uri mount, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(mount);
        ObjectDisposedException.ThrowIf(_disposed, this);

        await StopWatchingAsync().ConfigureAwait(false);

        _mount = mount;

        try
        {
            // Asked first, because a /Play against the URL the player is already on does nothing at
            // all: it neither restarts the stream nor says it did not. Unconditionally stopping
            // instead would put a gap in the audio every time the host retried after a poll failure.
            var before = await _client.StatusAsync(etag: null, longPoll: false, cancellationToken).ConfigureAwait(false);
            Remember(before);

            if (BluOsPlayPlan.StopFirst(before.State, BluOsPhase.Match(before.StreamUrl, mount)))
            {
                await _client.StopAsync(cancellationToken).ConfigureAwait(false);
            }

            await _client.PlayAsync(mount, _settings.Caption, _settings.Logo, cancellationToken).ConfigureAwait(false);
            _played = true;

            // Opening, flatly, rather than a phase read out of what /Play answered. The player says
            // `stream` the instant it accepts the request and then spends about six seconds actually
            // connecting, so believing that answer reports Buffering and is then corrected to
            // Opening by the first real reading — a listener watching the bar would see it go
            // backwards. Opening is what is true here: asked to play, nothing yet.
            Report(new PlayerStatus(PlayerPhase.Opening));
        }
        catch (Exception error) when (error is not OperationCanceledException and not OutOfMemoryException)
        {
            // Reported rather than thrown, which is what the machine's own player does: the host
            // decides what a failure means, and a listener has no use for an exception.
            Report(new PlayerStatus(PlayerPhase.Failed, $"{_client.Player} did not take the station: {error.Message}"));
            return;
        }

        StartWatching();
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        await StopWatchingAsync().ConfigureAwait(false);

        _mount = null;

        if (!_played)
        {
            Report(PlayerStatus.Stopped);
            return;
        }

        try
        {
            await _client.StopAsync(cancellationToken).ConfigureAwait(false);
            _played = false;

            // Reported from the command rather than from a status read afterwards. Measured: the
            // player answers `stop` and the very next /Status still says `stream`, so reading the
            // status back would report a stop that worked as one that failed.
            Report(PlayerStatus.Stopped);
        }
        catch (Exception error) when (error is not OperationCanceledException and not OutOfMemoryException)
        {
            // Worth saying loudly. A player that did not stop is still streaming, which is still an
            // audience to the station, and nothing else is going to notice.
            _logger.Error($"{_client.Player} did not stop and may still be playing the station", error);
            Report(new PlayerStatus(PlayerPhase.Failed, $"{_client.Player} did not stop: {error.Message}"));
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // Best effort, and worth the wait: a player left streaming after the app has forgotten about
        // it is an audience the station goes on counting with nothing left to end it.
        if (_played)
        {
            using var quickly = new CancellationTokenSource(TimeSpan.FromSeconds(3));

            try
            {
                await _client.StopAsync(quickly.Token).ConfigureAwait(false);
            }
            catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
            {
                _logger.Warn($"{_client.Player} may still be playing the station", error);
            }
        }

        await StopWatchingAsync().ConfigureAwait(false);
        _volume.Dispose();
    }

    private void StartWatching()
    {
        var watching = new CancellationTokenSource();

        lock (_gate)
        {
            _watching = watching;
        }

        _watcher = WatchAsync(watching.Token);
    }

    private async Task StopWatchingAsync()
    {
        CancellationTokenSource? watching;
        Task watcher;

        lock (_gate)
        {
            watching = _watching;
            watcher = _watcher;
            _watching = null;
        }

        if (watching is null)
        {
            return;
        }

        await watching.CancelAsync().ConfigureAwait(false);

        try
        {
            await watcher.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // The way it always ends.
        }

        watching.Dispose();
    }

    /// <summary>
    /// Watches one player for as long as it is meant to be playing.
    /// </summary>
    /// <remarks>
    /// Two regimes. Plainly at first, because warm-up turns on <c>secs</c> leaving zero and the
    /// position is not part of the etag, so a long poll would sit through the whole of it. Then the
    /// long poll, which is how a track boundary or a state change arrives without asking.
    /// </remarks>
    private async Task WatchAsync(CancellationToken cancellationToken)
    {
        var startedAt = _clock.GetUtcNow();
        var failures = 0;
        string? etag = null;

        while (!cancellationToken.IsCancellationRequested)
        {
            var fast = _clock.GetUtcNow() - startedAt < FastUntil || failures > 0;

            try
            {
                var status = await _client.StatusAsync(etag, longPoll: !fast, cancellationToken).ConfigureAwait(false);

                etag = status.Etag;
                failures = 0;
                Remember(status);

                if (_mount is { } mount)
                {
                    Report(BluOsPhase.From(status.State, status.Secs, BluOsPhase.Match(status.StreamUrl, mount)));
                }

                // The spec asks for at least a second between two requests, and a long poll that
                // returned early would otherwise be followed immediately by another.
                await Task.Delay(BetweenPolls, _clock, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
            {
                failures++;

                if (failures == FailuresBeforeSayingSo)
                {
                    // Said once, on the edge. Repeating it would step the host's backoff again on
                    // every poll, and the host is already counting.
                    Report(new PlayerStatus(PlayerPhase.Failed, $"{_client.Player} stopped answering: {error.Message}"));
                }

                await Task.Delay(
                    failures < FailuresBeforeSayingSo ? AfterAFailure : WhileUnreachable,
                    _clock,
                    cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private void Remember(BluOsStatus status)
    {
        // -1 is a player whose volume is fixed, which is "there is no volume here" rather than
        // silence. Keeping the last real reading means the slider does not drop to the bottom of its
        // travel and invite somebody to drag it.
        if (status.Volume is not { } level || level < 0)
        {
            return;
        }

        if (_level == level)
        {
            return;
        }

        _level = level;
        VolumeChanged?.Invoke();
    }

    private async Task SendVolumeAsync(int level, CancellationToken cancellationToken)
    {
        var answered = await _client.SetVolumeAsync(level, cancellationToken).ConfigureAwait(false);

        // Measured: the player answers with the level it now has, so nothing has to read it back.
        if (answered is { } now && now >= 0)
        {
            _level = now;
            VolumeChanged?.Invoke();
        }
    }

    private void Report(PlayerStatus status)
    {
        if (Status == status)
        {
            // Only changes. A boundary that moved nothing but the track's name is not a change to
            // what the player is doing, and the host would redraw for it.
            return;
        }

        Status = status;
        StatusChanged?.Invoke(status);
    }
}
