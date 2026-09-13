namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// Stops what this app is playing after a while.
/// </summary>
/// <remarks>
/// <para>
/// A convenience for a listener, and for this station more than that. A connection is an audience to
/// an audience-gated station, so somebody who falls asleep with the app playing keeps the station on
/// air for as long as the Mac stays awake. The timer's stop is the listener's own Stop, which drops
/// the connection, so the station hears the audience leave.
/// </para>
/// <para>
/// This is only the clock. What elapsing does belongs to whoever owns playback, and it never
/// reaches the station's own playout: it stops this listener and nothing else.
/// </para>
/// </remarks>
public sealed class SleepTimer(TimeProvider? time = null) : IDisposable
{
    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private readonly Lock _gate = new();
    private ITimer? _timer;

    /// <summary>When it will elapse, or null while it is not set.</summary>
    public DateTimeOffset? EndsAt { get; private set; }

    public bool IsSet => EndsAt is not null;

    /// <summary>Raised once when the time is up, on the thread the <see cref="TimeProvider"/> fires its timers on.</summary>
    public event Action? Elapsed;

    /// <summary>Sets it to elapse after <paramref name="after"/>, replacing any time already set.</summary>
    public void Set(TimeSpan after)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(after, TimeSpan.Zero);

        lock (_gate)
        {
            _timer?.Dispose();
            EndsAt = _time.GetUtcNow() + after;

            // The timer is captured so that one already on its way when it was replaced or cancelled
            // can tell it is no longer the current one and does nothing: the conductor's retry
            // guards itself the same way.
            ITimer? timer = null;
            timer = _time.CreateTimer(_ => OnElapsed(timer), null, after, Timeout.InfiniteTimeSpan);
            _timer = timer;
        }
    }

    public void Cancel()
    {
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
            EndsAt = null;
        }
    }

    /// <summary>How long is left, never below zero, or null while it is not set.</summary>
    public TimeSpan? Remaining(DateTimeOffset? now = null)
    {
        var endsAt = EndsAt;
        if (endsAt is null)
        {
            return null;
        }

        var left = endsAt.Value - (now ?? _time.GetUtcNow());
        return left < TimeSpan.Zero ? TimeSpan.Zero : left;
    }

    private void OnElapsed(ITimer? timer)
    {
        lock (_gate)
        {
            if (timer is null || !ReferenceEquals(timer, _timer))
            {
                return;
            }

            _timer.Dispose();
            _timer = null;
            EndsAt = null;
        }

        Elapsed?.Invoke();
    }

    public void Dispose() => Cancel();
}
