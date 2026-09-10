using NowPlayingReading = MaroonedSoftware.Deadair.Sdk.Models.NowPlaying;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// Holds a reading for a new record back until the audio has actually caught up to it.
/// </summary>
/// <remarks>
/// <para>
/// Measured directly against AVFoundation on the live station (<c>apps/desktop/CLAUDE.md</c>, "What
/// AVFoundation did on the first run"): the MP3 mount consistently took about five seconds to reach
/// <c>Playing</c>. A title that changes the instant the station reports a new record is up to five
/// seconds ahead of what is actually coming out of the speakers, so this holds a new item's reading
/// back for <see cref="NowPlayingLead"/> before letting it through.
/// </para>
/// <para>
/// A reading for the item already current (the listener count moving, a duration filled in a
/// moment later) carries none of that lag and is returned at once. So is the very first reading
/// this hold is ever offered: nothing has played yet either, and it deserves the same five seconds
/// as any other new item rather than a special case that skips them.
/// </para>
/// </remarks>
public sealed class NowPlayingHold(TimeProvider? time = null) : IDisposable
{
    /// <summary>Five seconds: the measured MP3 warm-up. See the type's own remarks.</summary>
    public static readonly TimeSpan NowPlayingLead = TimeSpan.FromSeconds(5);

    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private readonly object _gate = new();

    private string? _currentKey;
    private bool _hasCurrentKey;
    private string? _pendingKey;
    private NowPlayingReading? _pendingReading;
    private bool _hasPending;
    private ITimer? _timer;

    /// <summary>The reading currently in effect. Null until the first one has been released.</summary>
    public NowPlayingReading? Current { get; private set; }

    /// <summary>
    /// Raised on the thread the underlying <see cref="TimeProvider"/> fires its timer on, once a held
    /// reading's <see cref="NowPlayingLead"/> has elapsed. Never raised for a reading <see cref="Offer"/>
    /// already returned directly: a caller reacting only to this event would miss every same-item
    /// update.
    /// </summary>
    public event Action<NowPlayingReading>? Released;

    /// <summary>
    /// Offers a reading for the item named by <paramref name="itemKey"/>: a track's own identity, or
    /// null off air. A reading for the item already current is returned at once; a reading for a
    /// different one is held, this returns null, and <see cref="Released"/> fires with it once
    /// <see cref="NowPlayingLead"/> has elapsed, unless another new item arrives first, which
    /// replaces it before its own lead is ever spent.
    /// </summary>
    public NowPlayingReading? Offer(string? itemKey, NowPlayingReading reading)
    {
        ArgumentNullException.ThrowIfNull(reading);

        ITimer? replaced;

        lock (_gate)
        {
            if (_hasCurrentKey && itemKey == _currentKey)
            {
                Current = reading;
                return reading;
            }

            _pendingKey = itemKey;
            _pendingReading = reading;
            _hasPending = true;

            replaced = _timer;
            _timer = _time.CreateTimer(_ => Release(), null, NowPlayingLead, Timeout.InfiniteTimeSpan);
        }

        // Disposed outside the lock: nothing here needs to be held while a timer object tears itself
        // down, and disposing one while a new one for the same hold is mid-creation would be the
        // surprising order.
        replaced?.Dispose();
        return null;
    }

    private void Release()
    {
        NowPlayingReading reading;

        lock (_gate)
        {
            if (!_hasPending)
            {
                // Nothing pending: a second new item already replaced whatever this timer was for,
                // and that replacement's own timer is the one that gets to fire.
                return;
            }

            reading = _pendingReading!;
            _currentKey = _pendingKey;
            _hasCurrentKey = true;
            _hasPending = false;
            _pendingReading = null;
            _timer = null;
            Current = reading;
        }

        Released?.Invoke(reading);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
        }
    }
}
