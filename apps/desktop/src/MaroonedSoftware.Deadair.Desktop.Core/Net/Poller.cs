using MaroonedSoftware.Deadair.Desktop.Core.Ui;

namespace MaroonedSoftware.Deadair.Desktop.Core.Net;

/// <summary>
/// One question, asked on a interval, for as long as somebody is listening for the answer.
/// </summary>
/// <remarks>
/// <para>
/// <b>The lease is the point.</b> Nothing polls because a repository exists; it polls because a
/// screen took a lease and stops when the last one is disposed. That is what makes "the running order
/// stops being fetched when you leave the desk" a property of this type rather than a discipline
/// every view model has to remember, and it is the same arrangement the Android app gets from
/// <c>stateIn(WhileSubscribed)</c>.
/// </para>
/// <para>
/// A short grace period after the last lease means moving between two screens that read the same
/// thing does not tear the loop down and build it again.
/// </para>
/// <para>
/// <b>Failure widens the interval rather than stopping the loop.</b> A station that is down comes
/// back, and a client that gave up would need somebody to notice and press something; one that
/// hammered it every two seconds for an hour is a client making an outage worse.
/// </para>
/// </remarks>
public sealed class Poller<T> : IAsyncDisposable
{
    private static readonly TimeSpan Grace = TimeSpan.FromSeconds(5);

    private readonly Func<CancellationToken, Task<T>> _read;
    private readonly TimeSpan _interval;
    private readonly TimeSpan _slowest;
    private readonly IUiDispatcher _dispatcher;
    private readonly TimeProvider _time;
    private readonly object _gate = new();

    private CancellationTokenSource? _loop;
    private Task? _running;
    private int _leases;
    private CancellationTokenSource? _wake;
    private CancellationTokenSource? _teardown;

    public Poller(
        Func<CancellationToken, Task<T>> read,
        TimeSpan interval,
        IUiDispatcher? dispatcher = null,
        TimeProvider? time = null,
        TimeSpan? slowest = null)
    {
        ArgumentNullException.ThrowIfNull(read);

        _read = read;
        _interval = interval;
        _slowest = slowest ?? TimeSpan.FromSeconds(30);
        _dispatcher = dispatcher ?? ImmediateUiDispatcher.Instance;
        _time = time ?? TimeProvider.System;
    }

    public Reading<T> Current { get; private set; } = Reading<T>.Empty;

    /// <summary>Raised on the UI dispatcher after every attempt, successful or not.</summary>
    public event Action<Reading<T>>? Changed;

    /// <summary>Starts the loop if it is not running, and keeps it running until disposed.</summary>
    public IDisposable Subscribe()
    {
        lock (_gate)
        {
            _leases++;

            // A lease taken back inside the grace period cancels the teardown rather than restarting
            // the loop, so flicking between two screens does not drop the reading.
            _teardown?.Cancel();
            _teardown = null;

            if (_loop is null)
            {
                _loop = new CancellationTokenSource();
                _running = Task.Run(() => RunAsync(_loop.Token));
            }
        }

        return new Lease(this);
    }

    /// <summary>Asks now rather than at the next interval, and resets any backoff.</summary>
    public void Kick()
    {
        lock (_gate)
        {
            _wake?.Cancel();
        }
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var wait = _interval;

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var value = await _read(cancellationToken).ConfigureAwait(false);
                Publish(Reading<T>.Good(value, _time.GetUtcNow()));
                wait = _interval;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception failure)
            {
                Publish(Current.Failed(failure));

                var doubled = wait * 2;
                wait = doubled > _slowest ? _slowest : doubled;
            }

            using var wake = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            lock (_gate)
            {
                _wake = wake;
            }

            try
            {
                await Task.Delay(wait, _time, wake.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    return;
                }

                // Kicked. Ask again at once, and forget any backoff: something changed and the whole
                // reason to kick is that the answer is expected to be different.
                wait = _interval;
            }
            finally
            {
                lock (_gate)
                {
                    _wake = null;
                }
            }
        }
    }

    private void Publish(Reading<T> reading)
    {
        Current = reading;
        var handler = Changed;
        if (handler is not null)
        {
            _dispatcher.Post(() => handler(reading));
        }
    }

    private void Release()
    {
        lock (_gate)
        {
            _leases--;
            if (_leases > 0)
            {
                return;
            }

            _teardown = new CancellationTokenSource();
            var teardown = _teardown;
            _ = StopAfterGraceAsync(teardown.Token);
        }
    }

    private async Task StopAfterGraceAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(Grace, _time, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Somebody took a lease again inside the grace period.
            return;
        }

        CancellationTokenSource? loop;
        lock (_gate)
        {
            if (_leases > 0)
            {
                return;
            }

            loop = _loop;
            _loop = null;
            _running = null;
        }

        if (loop is not null)
        {
            await loop.CancelAsync().ConfigureAwait(false);
            loop.Dispose();
        }
    }

    public async ValueTask DisposeAsync()
    {
        CancellationTokenSource? loop;
        Task? running;

        lock (_gate)
        {
            loop = _loop;
            running = _running;
            _loop = null;
            _running = null;
            _leases = 0;
        }

        if (loop is not null)
        {
            await loop.CancelAsync().ConfigureAwait(false);
            loop.Dispose();
        }

        if (running is not null)
        {
            try
            {
                await running.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Expected: that is how the loop ends.
            }
        }
    }

    private sealed class Lease(Poller<T> poller) : IDisposable
    {
        private bool _released;

        public void Dispose()
        {
            if (_released)
            {
                return;
            }

            _released = true;
            poller.Release();
        }
    }
}
