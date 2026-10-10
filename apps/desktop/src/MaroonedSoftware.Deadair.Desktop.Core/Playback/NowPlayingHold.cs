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
/// <para>
/// <b>What it releases comes with when the listener hears it.</b> <see cref="Heard"/> pairs the reading
/// in effect with the instant its moment reaches the speakers: when it was read, plus the same
/// <see cref="NowPlayingLead"/>. The playhead projects from that, not from when the poll answered,
/// because the title waits for the audio and a bar projected from the poll's own stamp did not: it ran
/// the lead ahead of the record it was drawn under, and while a new record was held it projected the
/// NEXT record's countdown under the current one's title.
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
    private DateTimeOffset? _pendingReadAt;
    private bool _hasPending;
    private ITimer? _timer;

    /// <summary>The reading currently in effect. Null until the first one has been released.</summary>
    public NowPlayingReading? Current { get; private set; }

    /// <summary>
    /// <see cref="Current"/> with the instant the listener hears the moment it describes, set in the
    /// same step so the two can never be from different readings. Null until the first release.
    /// </summary>
    public HeardReading? Heard { get; private set; }

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
    /// <param name="itemKey">The item's identity, or null off air.</param>
    /// <param name="reading">The reading.</param>
    /// <param name="readAt">When the reading was taken, which <see cref="Heard"/> moves on by the lead.</param>
    public NowPlayingReading? Offer(string? itemKey, NowPlayingReading reading, DateTimeOffset? readAt = null)
    {
        ArgumentNullException.ThrowIfNull(reading);

        ITimer? replaced;

        lock (_gate)
        {
            if (_hasCurrentKey && itemKey == _currentKey)
            {
                Current = reading;
                Heard = new HeardReading(reading, readAt + NowPlayingLead);
                return reading;
            }

            // The item already held, read again: the station is polled faster than the lead, so this
            // is the ordinary case. Its lead keeps running and the newer reading is what it releases.
            // Restarting the lead here meant an item polled every three seconds against a five-second
            // lead was never released at all.
            if (_hasPending && itemKey == _pendingKey)
            {
                _pendingReading = reading;
                _pendingReadAt = readAt;
                return null;
            }

            _pendingKey = itemKey;
            _pendingReading = reading;
            _pendingReadAt = readAt;
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
            Heard = new HeardReading(reading, _pendingReadAt + NowPlayingLead);
            _pendingReading = null;
            _pendingReadAt = null;
            _timer = null;
            Current = reading;
        }

        Released?.Invoke(reading);
    }

    /// <summary>
    /// Forgets the current item and anything held, for a listener pointed at a different station.
    /// </summary>
    /// <remarks>
    /// Without it a record the old station announced a moment before the switch would be released
    /// onto the new station's screen a few seconds later. A timer already firing when this runs
    /// finds nothing pending and does nothing.
    /// </remarks>
    public void Reset()
    {
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
            _hasPending = false;
            _pendingReading = null;
            _pendingReadAt = null;
            _pendingKey = null;
            _hasCurrentKey = false;
            _currentKey = null;
            Current = null;
            Heard = null;
        }
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
