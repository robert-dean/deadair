using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>What a listener should be told the player is doing.</summary>
public enum ListeningState
{
    /// <summary>Not listening.</summary>
    Stopped,

    /// <summary>
    /// Asked to play and no audio yet.
    /// </summary>
    /// <remarks>
    /// This covers a case that looks like a fault and is not. On an audience-gated station,
    /// connecting is what puts it on air — so the first seconds after pressing play are the lease
    /// being taken, the first record being fetched and the encoder starting, and there is legitimately
    /// no audio during them. A client that drew this as an error, or as a spinner that never resolves,
    /// would be misreporting the station's ordinary behaviour.
    /// </remarks>
    WarmingUp,

    Playing,

    /// <summary>Was playing, lost it, and is trying again.</summary>
    Reconnecting,

    /// <summary>Tried for long enough that something is actually wrong.</summary>
    Unreachable,
}

/// <summary>
/// The policy above whichever player the platform supplies: what a phase MEANS, and when to try again.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately not inside <see cref="IStationPlayer"/>. Every platform's media stack reports
/// roughly the same states and none of them knows what this station does with a connection, so the
/// interpretation is written once, here, where it can be tested without a sound card. An
/// implementation reports; this decides.
/// </para>
/// <para>
/// The rule that shapes it: <b>a failure before the first successful play is warm-up, not a fault.</b>
/// Both because the station may be waking up, and because a listener who has just pressed play has
/// no use for an error they cannot act on. Only after audio has been heard does losing it become
/// reconnecting, and only after <see cref="Backoff.GiveUpAfter"/> does it become unreachable.
/// </para>
/// <para>
/// <b>A wait that never ends is a drop.</b> AVPlayer reports a dead connection as a failure only some
/// of the time; the rest of the time it sits waiting for bytes that are not coming, and a wait after
/// audio reads as playing, so the bar said Listening over silence for as long as it was left. A wait
/// that outlasts its limit is now the failure the player did not report, and goes through the same
/// backoff. Each reload repeats Icecast's burst and costs the audible seconds it takes, so the limit
/// asks the media clock first: a clock that has moved means the phase is stale and the audio is fine.
/// </para>
/// <para>
/// Not thread safe. Everything but the timers runs on the UI thread, and the timers only raise an
/// event for the host to marshal back, which is also what lets the clock be read at all.
/// </para>
/// </remarks>
public sealed class PlaybackConductor : IDisposable
{
    /// <summary>
    /// How long a connection that has been carrying audio may wait for more: long enough for an
    /// ordinary hiccup, short of the point where a listener has given up on it.
    /// </summary>
    public static readonly TimeSpan StallLimit = TimeSpan.FromSeconds(10);

    /// <summary>
    /// How long a connection may go without its first audio, several times the five seconds the MP3
    /// mount takes. It covers every retry as well as the first press of play: a new connection is
    /// warm-up whether or not audio was heard on the last one, so a retry on the shorter limit could
    /// be cut off while the station it just woke was still starting.
    /// </summary>
    public static readonly TimeSpan WarmUpLimit = TimeSpan.FromSeconds(30);

    /// <summary>
    /// How far the clock has to move to count. Far below what a healthy stream covers in either limit,
    /// so all this can do is stop a clock that only twitched from holding off a reload for ever.
    /// </summary>
    private static readonly TimeSpan MinimumAdvance = TimeSpan.FromSeconds(1);

    private readonly Backoff _backoff = new();
    private readonly TimeProvider _time;
    private readonly Func<TimeSpan?> _clock;
    private bool _heardAudio;
    private bool _wantsToPlay;
    private ITimer? _retryTimer;

    /// <summary>Whether the current connection has produced audio, as against any connection since play.</summary>
    private bool _carryingAudio;

    /// <summary>A retry is replacing the player, so the stop it is about to report is ours.</summary>
    private bool _reloading;

    private ITimer? _stallTimer;
    private DateTimeOffset? _stallDeadline;
    private TimeSpan? _stallPosition;

    /// <param name="time">Where the timers come from.</param>
    /// <param name="clock">
    /// The player's media clock, read on the caller's thread. Null, or an answer of null, means nobody
    /// can say, and a wait at its limit is then treated as the drop it most likely is.
    /// </param>
    public PlaybackConductor(TimeProvider? time = null, Func<TimeSpan?>? clock = null)
    {
        _time = time ?? TimeProvider.System;
        _clock = clock ?? (() => null);
    }

    public ListeningState State { get; private set; } = ListeningState.Stopped;

    /// <summary>How long to wait before the next attempt, or null when none is due.</summary>
    public TimeSpan? RetryIn { get; private set; }

    /// <summary>
    /// Raised on the thread the underlying <see cref="TimeProvider"/> fires its timer on, once
    /// <see cref="RetryIn"/> has elapsed and the listener still wants to be playing.
    /// </summary>
    public event Action? RetryDue;

    /// <summary>
    /// Raised on the timer's thread once a wait for audio reaches its limit. The host marshals to the
    /// UI thread and calls <see cref="StallElapsed"/>.
    /// </summary>
    public event Action? StallDue;

    /// <summary>The listener pressed play.</summary>
    public void Requested()
    {
        _wantsToPlay = true;
        _heardAudio = false;
        _carryingAudio = false;
        _reloading = false;
        _backoff.Reset();
        RetryIn = null;
        State = ListeningState.WarmingUp;
        DisarmRetry();
        DisarmStall();
    }

    /// <summary>The listener pressed stop.</summary>
    public void Released()
    {
        _wantsToPlay = false;
        _heardAudio = false;
        _carryingAudio = false;
        _reloading = false;
        _backoff.Reset();
        RetryIn = null;
        State = ListeningState.Stopped;
        DisarmRetry();
        DisarmStall();
    }

    /// <summary>
    /// The host is acting on <see cref="RetryDue"/>. Answers whether the retry is still wanted, since
    /// the listener may have pressed stop or the player recovered while the event was on its way.
    /// </summary>
    /// <remarks>
    /// The watch starts here rather than at the attempt's first reading, so an attempt is watched even
    /// if it never reports anything at all.
    /// </remarks>
    public bool BeginRetry()
    {
        DisarmRetry();

        if (!_wantsToPlay || _carryingAudio)
        {
            return false;
        }

        _reloading = true;
        RetryIn = null;
        DisarmStall();
        WatchStall();
        return true;
    }

    /// <summary>
    /// The host's answer to <see cref="StallDue"/>. Answers true if the wait became a drop, which
    /// changed <see cref="State"/>.
    /// </summary>
    public bool StallElapsed()
    {
        // The wait may have ended, or a later one begun, while the event was on its way.
        if (_stallDeadline is not { } deadline || _time.GetUtcNow() < deadline)
        {
            return false;
        }

        var before = _stallPosition;
        var now = _clock();
        DisarmStall();

        if (now - before >= MinimumAdvance)
        {
            // Audio is coming out whatever the phase says, so this connection is left alone and
            // watched again from here, in case it is the tail of a buffer running out.
            WatchStall();
            _stallPosition = now;
            return false;
        }

        Drop();
        return true;
    }

    /// <summary>A reading from the player.</summary>
    public void Observed(PlayerStatus status)
    {
        if (!_wantsToPlay)
        {
            State = ListeningState.Stopped;
            RetryIn = null;
            return;
        }

        switch (status.Phase)
        {
            case PlayerPhase.Playing:
                _heardAudio = true;
                _carryingAudio = true;
                _reloading = false;
                _backoff.Reset();
                RetryIn = null;
                State = ListeningState.Playing;
                DisarmRetry();
                DisarmStall();
                break;

            case PlayerPhase.Opening:
            case PlayerPhase.Buffering:
                _reloading = false;

                // A drop already has a retry coming, and having given up is left to Requested or to
                // audio: neither is a wait to watch.
                if (_retryTimer is not null || State == ListeningState.Unreachable)
                {
                    break;
                }

                RetryIn = null;

                // Buffering after audio has been heard is an ordinary hiccup and stays "playing", so
                // a two-second stall does not flash a reconnecting banner at somebody. A retry has no
                // audio to hide a hiccup in, so it goes on saying what is happening.
                State = _carryingAudio ? ListeningState.Playing
                    : _heardAudio ? ListeningState.Reconnecting
                    : ListeningState.WarmingUp;

                // Started once per wait. A network player repeats itself on each poll, and restarting
                // the timer on every reading would mean it never ran out.
                WatchStall();
                _stallPosition ??= _clock();
                break;

            case PlayerPhase.Ended:
            case PlayerPhase.Failed:
                _reloading = false;
                Drop();
                break;

            case PlayerPhase.Stopped:
                // The player stopping while the listener still wants to hear it means something took
                // it down; treat it as a drop rather than as the listener's own stop. Unless a retry
                // is what took it down: the old player reports that on its way out, and counting it
                // would spend the backoff and arm a second retry on top of the attempt in progress.
                if (_heardAudio && !_reloading)
                {
                    Drop();
                }

                break;
        }
    }

    /// <summary>
    /// The connection is gone, whoever noticed: schedules the next attempt, or gives up.
    /// </summary>
    private void Drop()
    {
        _carryingAudio = false;
        DisarmStall();

        RetryIn = _backoff.Next();
        State = _backoff.Exhausted
            ? ListeningState.Unreachable
            : _heardAudio ? ListeningState.Reconnecting : ListeningState.WarmingUp;

        // Exhausted means the class has genuinely given up: arming another timer here would retry
        // every 30 seconds forever under an "Unreachable" banner that says otherwise.
        if (_backoff.Exhausted)
        {
            DisarmRetry();
        }
        else
        {
            ArmRetry(RetryIn.Value);
        }
    }

    /// <summary>Starts the timer on a wait for audio, unless that wait already has one.</summary>
    private void WatchStall()
    {
        if (_stallTimer is not null)
        {
            return;
        }

        var limit = _carryingAudio ? StallLimit : WarmUpLimit;
        _stallDeadline = _time.GetUtcNow() + limit;
        _stallTimer = _time.CreateTimer(_ => StallDue?.Invoke(), null, limit, Timeout.InfiniteTimeSpan);
    }

    private void DisarmStall()
    {
        _stallTimer?.Dispose();
        _stallTimer = null;
        _stallDeadline = null;
        _stallPosition = null;
    }

    /// <summary>
    /// Arms a one-shot timer for the wait <see cref="Drop"/> just computed, replacing whichever
    /// one is already pending: only the most recent failure's wait is worth honouring.
    /// </summary>
    private void ArmRetry(TimeSpan wait)
    {
        DisarmRetry();
        _retryTimer = _time.CreateTimer(_ => OnRetryTimerElapsed(), null, wait, Timeout.InfiniteTimeSpan);
    }

    private void OnRetryTimerElapsed()
    {
        // The listener may have pressed stop, or the player may already have reconnected on its own,
        // in the moment between the timer being armed and it firing.
        if (_wantsToPlay)
        {
            RetryDue?.Invoke();
        }
    }

    private void DisarmRetry()
    {
        _retryTimer?.Dispose();
        _retryTimer = null;
    }

    public void Dispose()
    {
        DisarmRetry();
        DisarmStall();
    }
}
