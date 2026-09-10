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
/// </remarks>
public sealed class PlaybackConductor : IDisposable
{
    private readonly Backoff _backoff = new();
    private readonly TimeProvider _time;
    private bool _heardAudio;
    private bool _wantsToPlay;
    private ITimer? _retryTimer;

    public PlaybackConductor(TimeProvider? time = null)
    {
        _time = time ?? TimeProvider.System;
    }

    public ListeningState State { get; private set; } = ListeningState.Stopped;

    /// <summary>How long to wait before the next attempt, or null when none is due.</summary>
    public TimeSpan? RetryIn { get; private set; }

    /// <summary>
    /// Raised on the thread the underlying <see cref="TimeProvider"/> fires its timer on, once
    /// <see cref="RetryIn"/> has elapsed and the listener still wants to be playing.
    /// </summary>
    public event Action? RetryDue;

    /// <summary>The listener pressed play.</summary>
    public void Requested()
    {
        _wantsToPlay = true;
        _heardAudio = false;
        _backoff.Reset();
        RetryIn = null;
        State = ListeningState.WarmingUp;
        DisarmRetry();
    }

    /// <summary>The listener pressed stop.</summary>
    public void Released()
    {
        _wantsToPlay = false;
        _heardAudio = false;
        _backoff.Reset();
        RetryIn = null;
        State = ListeningState.Stopped;
        DisarmRetry();
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
                _backoff.Reset();
                RetryIn = null;
                State = ListeningState.Playing;
                DisarmRetry();
                break;

            case PlayerPhase.Opening:
            case PlayerPhase.Buffering:
                RetryIn = null;

                // Buffering after audio has been heard is an ordinary hiccup and stays "playing", so
                // a two-second stall does not flash a reconnecting banner at somebody.
                State = _heardAudio ? ListeningState.Playing : ListeningState.WarmingUp;
                break;

            case PlayerPhase.Ended:
            case PlayerPhase.Failed:
                RetryIn = _backoff.Next();
                State = _backoff.Exhausted
                    ? ListeningState.Unreachable
                    : _heardAudio ? ListeningState.Reconnecting : ListeningState.WarmingUp;

                // Exhausted means the class has genuinely given up: arming another timer here would
                // retry every 30 seconds forever under an "Unreachable" banner that says otherwise.
                if (_backoff.Exhausted)
                {
                    DisarmRetry();
                }
                else
                {
                    ArmRetry(RetryIn.Value);
                }

                break;

            case PlayerPhase.Stopped:
                // The player stopping while the listener still wants to hear it means something took
                // it down; treat it as a drop rather than as the listener's own stop.
                if (_heardAudio)
                {
                    RetryIn = _backoff.Next();
                    State = _backoff.Exhausted ? ListeningState.Unreachable : ListeningState.Reconnecting;

                    if (_backoff.Exhausted)
                    {
                        DisarmRetry();
                    }
                    else
                    {
                        ArmRetry(RetryIn.Value);
                    }
                }

                break;
        }
    }

    /// <summary>
    /// Arms a one-shot timer for the wait <see cref="Observed"/> just computed, replacing whichever
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

    public void Dispose() => DisarmRetry();
}
