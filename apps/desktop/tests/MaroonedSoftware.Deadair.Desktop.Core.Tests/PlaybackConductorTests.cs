using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What a listener is told, for each thing the platform's player can do.
///
/// The conductor exists so that this is decidable without a sound card, and the cases below are the
/// ones where the obvious reading is wrong: a station that is waking up looks exactly like a station
/// that is broken, and a two-second stall looks exactly like a dropped connection.
/// </summary>
public class PlaybackConductorTests
{
    [Fact]
    public void SaysWarmingUpBeforeAnyAudioArrives()
    {
        var conductor = new PlaybackConductor();

        conductor.Requested();

        Assert.Equal(ListeningState.WarmingUp, conductor.State);
    }

    [Fact]
    public void TreatsAFailureBeforeTheFirstAudioAsWarmUp_NotAsAFault()
    {
        // The case this whole type exists for. Connecting is what puts an audience-gated station on
        // air, so the first attempts can legitimately fail while the station takes its lease, fetches
        // a record and starts its encoder. Showing an error here reports the station's ordinary
        // behaviour as a fault, to a listener who can do nothing about it.
        var conductor = new PlaybackConductor();
        conductor.Requested();

        conductor.Observed(new PlayerStatus(PlayerPhase.Failed, "Connection refused."));

        Assert.Equal(ListeningState.WarmingUp, conductor.State);
        Assert.NotNull(conductor.RetryIn);
    }

    [Fact]
    public void SaysReconnectingOnlyAfterAudioHasActuallyBeenHeard()
    {
        var conductor = new PlaybackConductor();
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        conductor.Observed(new PlayerStatus(PlayerPhase.Ended, "The stream ended."));

        Assert.Equal(ListeningState.Reconnecting, conductor.State);
    }

    [Fact]
    public void KeepsSayingPlayingThroughAStallOnceAudioHasBeenHeard()
    {
        // A few seconds of rebuffering on a live stream is ordinary. Flashing a reconnecting banner
        // at every one of them trains a listener to ignore the banner.
        var conductor = new PlaybackConductor();
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        conductor.Observed(new PlayerStatus(PlayerPhase.Buffering));

        Assert.Equal(ListeningState.Playing, conductor.State);
    }

    [Fact]
    public void GivesUpOnlyAfterTheBackoffIsSpent()
    {
        var conductor = new PlaybackConductor();
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        var states = new List<ListeningState>();
        for (var attempt = 0; attempt < 40; attempt++)
        {
            conductor.Observed(new PlayerStatus(PlayerPhase.Playing));
            conductor.Observed(new PlayerStatus(PlayerPhase.Failed));
            states.Add(conductor.State);
        }

        // Every one of those is a reconnect rather than a surrender, because each success resets the
        // clock. A client that counted attempts instead of elapsed time would have given up on a
        // listener whose connection is merely poor.
        Assert.All(states, state => Assert.Equal(ListeningState.Reconnecting, state));
    }

    [Fact]
    public void SaysUnreachableOnceTheAttemptsHaveSpannedTheGiveUpWindow()
    {
        var conductor = new PlaybackConductor();
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        for (var attempt = 0; attempt < 30; attempt++)
        {
            conductor.Observed(new PlayerStatus(PlayerPhase.Failed));
        }

        Assert.Equal(ListeningState.Unreachable, conductor.State);
    }

    [Fact]
    public void OnceExhausted_AdvancingPastTheCeilingRaisesNoRetryDue()
    {
        // Unreachable is the class's own word for having given up. Arming another timer past that
        // point would retry every 30 seconds forever under a banner that says otherwise.
        var time = new FakeTimeProvider();
        var conductor = new PlaybackConductor(time);
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        for (var attempt = 0; attempt < 30; attempt++)
        {
            conductor.Observed(new PlayerStatus(PlayerPhase.Failed));
        }

        Assert.Equal(ListeningState.Unreachable, conductor.State);

        var fired = 0;
        conductor.RetryDue += () => fired++;

        time.Advance(TimeSpan.FromSeconds(60));

        Assert.Equal(0, fired);
    }

    [Fact]
    public void StoppingEndsIt_AndAPlayerStillSettlingDoesNotUndoThat()
    {
        var conductor = new PlaybackConductor();
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        conductor.Released();

        // A native player reports its way down after being told to stop. None of that may put the app
        // back into reconnecting, or pressing stop would start a retry loop.
        conductor.Observed(new PlayerStatus(PlayerPhase.Failed, "Cancelled."));
        conductor.Observed(new PlayerStatus(PlayerPhase.Stopped));

        Assert.Equal(ListeningState.Stopped, conductor.State);
        Assert.Null(conductor.RetryIn);
    }

    [Fact]
    public void APlayerThatStopsByItselfIsADrop_AndIsRetried()
    {
        var conductor = new PlaybackConductor();
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        conductor.Observed(new PlayerStatus(PlayerPhase.Stopped));

        Assert.Equal(ListeningState.Reconnecting, conductor.State);
    }

    [Fact]
    public void FiresRetryDueOnceRetryInElapses_AndNotBefore()
    {
        var time = new FakeTimeProvider();
        var conductor = new PlaybackConductor(time);
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        conductor.Observed(new PlayerStatus(PlayerPhase.Failed));
        var fired = 0;
        conductor.RetryDue += () => fired++;

        time.Advance(conductor.RetryIn!.Value - TimeSpan.FromMilliseconds(1));
        Assert.Equal(0, fired);

        time.Advance(TimeSpan.FromMilliseconds(1));
        Assert.Equal(1, fired);
    }

    [Fact]
    public void ReleasedBeforeTheRetryIsDue_MeansItNeverFires()
    {
        var time = new FakeTimeProvider();
        var conductor = new PlaybackConductor(time);
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));
        conductor.Observed(new PlayerStatus(PlayerPhase.Failed));

        var fired = 0;
        conductor.RetryDue += () => fired++;

        conductor.Released();
        time.Advance(TimeSpan.FromMinutes(1));

        Assert.Equal(0, fired);
    }

    [Fact]
    public void ReachingPlayingBeforeTheRetryIsDue_MeansItNeverFires()
    {
        var time = new FakeTimeProvider();
        var conductor = new PlaybackConductor(time);
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));
        conductor.Observed(new PlayerStatus(PlayerPhase.Failed));

        var fired = 0;
        conductor.RetryDue += () => fired++;

        // Reconnected on its own before the scheduled retry: the timer that was counting down to a
        // retry that is no longer needed must not go on to fire one anyway.
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));
        time.Advance(TimeSpan.FromMinutes(1));

        Assert.Equal(0, fired);
    }

    [Fact]
    public void ASecondFailureRearmsWithTheLongerBackoff()
    {
        var time = new FakeTimeProvider();
        var conductor = new PlaybackConductor(time);
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        conductor.Observed(new PlayerStatus(PlayerPhase.Failed));
        var firstWait = conductor.RetryIn!.Value;

        conductor.Observed(new PlayerStatus(PlayerPhase.Failed));
        var secondWait = conductor.RetryIn!.Value;
        Assert.True(secondWait > firstWait);

        var fired = 0;
        conductor.RetryDue += () => fired++;

        // The first failure's wait has fully elapsed, but that timer was replaced rather than left to
        // fire alongside the second one.
        time.Advance(firstWait);
        Assert.Equal(0, fired);

        time.Advance(secondWait - firstWait);
        Assert.Equal(1, fired);
    }

    /// <summary>
    /// A conductor wired the way the listener wires it, minus the dispatcher: a timer that runs out
    /// asks the conductor at once, and every retry it wants is counted as a reload.
    /// </summary>
    private sealed class Rig
    {
        public FakeTimeProvider Time { get; } = new();

        /// <summary>What the player's clock says. Leave null for a player without one.</summary>
        public TimeSpan? Position { get; set; }

        public int Reloads { get; private set; }

        public PlaybackConductor Conductor { get; }

        public Rig()
        {
            Conductor = new PlaybackConductor(Time, () => Position);
            Conductor.StallDue += () => Conductor.StallElapsed();
            Conductor.RetryDue += () =>
            {
                if (Conductor.BeginRetry())
                {
                    Reloads++;
                }
            };
        }

        public void Reads(PlayerPhase phase) => Conductor.Observed(new PlayerStatus(phase));

        /// <summary>Audio has been heard and the connection has just gone quiet.</summary>
        public void Stalled()
        {
            Conductor.Requested();
            Reads(PlayerPhase.Opening);
            Reads(PlayerPhase.Playing);
            Reads(PlayerPhase.Buffering);
        }

        /// <summary>The scenario this exists for: a stall that outlasted the limit, and its retry.</summary>
        public void StalledIntoARetry()
        {
            Stalled();
            Time.Advance(PlaybackConductor.StallLimit);
            Time.Advance(Conductor.RetryIn!.Value);
        }
    }

    [Fact]
    public void AStallPastTheLimitIsADrop_EvenThoughThePlayerNeverSaidSo()
    {
        // Wifi gone with the stream open: AVPlayer waits for bytes that are not coming and reports no
        // failure, so nothing but this limit ever takes the bar off Listening.
        var rig = new Rig();
        rig.Stalled();

        rig.Time.Advance(PlaybackConductor.StallLimit - TimeSpan.FromMilliseconds(1));
        Assert.Equal(ListeningState.Playing, rig.Conductor.State);

        rig.Time.Advance(TimeSpan.FromMilliseconds(1));
        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);
        Assert.NotNull(rig.Conductor.RetryIn);
        Assert.Equal(0, rig.Reloads);

        rig.Time.Advance(rig.Conductor.RetryIn!.Value);
        Assert.Equal(1, rig.Reloads);
    }

    [Fact]
    public void AnOrdinaryHiccupThatResumesInsideTheLimitReloadsNothing()
    {
        var rig = new Rig();
        rig.Stalled();

        rig.Time.Advance(PlaybackConductor.StallLimit - TimeSpan.FromSeconds(1));
        rig.Reads(PlayerPhase.Playing);
        rig.Time.Advance(TimeSpan.FromMinutes(1));

        Assert.Equal(ListeningState.Playing, rig.Conductor.State);
        Assert.Equal(0, rig.Reloads);
    }

    [Fact]
    public void AClockThatHasMovedMeansThePhaseIsStale_AndAHealthyStreamIsNeverReloaded()
    {
        // A stall notification can leave the phase at Buffering with audio still coming out. Reloading
        // that would cut off a stream that is fine and repeat Icecast's burst, however long it lasts.
        var rig = new Rig { Position = TimeSpan.FromSeconds(100) };
        rig.Stalled();

        for (var limit = 0; limit < 20; limit++)
        {
            rig.Position += PlaybackConductor.StallLimit;
            rig.Time.Advance(PlaybackConductor.StallLimit);
        }

        Assert.Equal(ListeningState.Playing, rig.Conductor.State);
        Assert.Null(rig.Conductor.RetryIn);
        Assert.Equal(0, rig.Reloads);
    }

    [Fact]
    public void AClockThatStopsAfterMovingIsStillCaught_OneLimitLater()
    {
        // The tail of a buffer playing out, then nothing. The first limit passes on the clock, which
        // must not be the end of the watching.
        var rig = new Rig { Position = TimeSpan.FromSeconds(100) };
        rig.Stalled();

        rig.Position += TimeSpan.FromSeconds(3);
        rig.Time.Advance(PlaybackConductor.StallLimit);
        Assert.Equal(ListeningState.Playing, rig.Conductor.State);

        rig.Time.Advance(PlaybackConductor.StallLimit);
        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);
    }

    [Fact]
    public void AClockThatStood_IsADrop()
    {
        var rig = new Rig { Position = TimeSpan.FromSeconds(100) };
        rig.Stalled();

        rig.Time.Advance(PlaybackConductor.StallLimit);

        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);
    }

    [Fact]
    public void AClockThatOnlyTwitched_IsADrop()
    {
        // Moving a hair would otherwise hold off the reload one limit at a time, for ever.
        var rig = new Rig { Position = TimeSpan.FromSeconds(100) };
        rig.Stalled();

        rig.Position += TimeSpan.FromMilliseconds(50);
        rig.Time.Advance(PlaybackConductor.StallLimit);

        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);
    }

    [Fact]
    public void ARetryThatHangsInOpeningIsWatchedToo_AndKeepsSpendingTheBackoff()
    {
        var rig = new Rig();
        rig.StalledIntoARetry();
        Assert.Equal(1, rig.Reloads);
        var firstWait = TimeSpan.FromSeconds(1);

        rig.Reads(PlayerPhase.Stopped);
        rig.Reads(PlayerPhase.Opening);

        rig.Time.Advance(PlaybackConductor.WarmUpLimit - TimeSpan.FromMilliseconds(1));
        Assert.Null(rig.Conductor.RetryIn);

        rig.Time.Advance(TimeSpan.FromMilliseconds(1));
        Assert.Equal(firstWait * 2, rig.Conductor.RetryIn);

        rig.Time.Advance(rig.Conductor.RetryIn!.Value);
        Assert.Equal(2, rig.Reloads);
    }

    [Fact]
    public void ARetryThatNeverReportsAnythingIsWatched()
    {
        // Nothing to arm a watch from a reading: the mounts were unavailable, or a device took the
        // request and went quiet.
        var rig = new Rig();
        rig.StalledIntoARetry();

        rig.Time.Advance(PlaybackConductor.WarmUpLimit);

        Assert.NotNull(rig.Conductor.RetryIn);
        rig.Time.Advance(rig.Conductor.RetryIn!.Value);
        Assert.Equal(2, rig.Reloads);
    }

    [Fact]
    public void WarmUpIsWatchedOnItsOwnLimit()
    {
        var rig = new Rig();
        rig.Conductor.Requested();
        rig.Reads(PlayerPhase.Opening);

        rig.Time.Advance(PlaybackConductor.StallLimit);
        Assert.Null(rig.Conductor.RetryIn);

        rig.Time.Advance(PlaybackConductor.WarmUpLimit - PlaybackConductor.StallLimit);
        Assert.Equal(ListeningState.WarmingUp, rig.Conductor.State);
        Assert.NotNull(rig.Conductor.RetryIn);
    }

    [Fact]
    public void TheOldPlayerStoppingForARetryIsNotASecondDrop()
    {
        // The Mac's player reports Stopped when a retry tears it down. Counting that spent the backoff
        // and armed another reload on top of the attempt it belonged to, which for the five seconds
        // the MP3 mount takes to answer meant cutting that attempt off.
        var rig = new Rig();
        rig.StalledIntoARetry();

        rig.Reads(PlayerPhase.Stopped);
        rig.Reads(PlayerPhase.Opening);

        Assert.Null(rig.Conductor.RetryIn);
        rig.Time.Advance(TimeSpan.FromSeconds(5));
        Assert.Equal(1, rig.Reloads);
    }

    [Fact]
    public void AStopOnceTheRetryIsConnectingIsARealDrop()
    {
        var rig = new Rig();
        rig.StalledIntoARetry();
        rig.Reads(PlayerPhase.Stopped);
        rig.Reads(PlayerPhase.Opening);

        rig.Reads(PlayerPhase.Stopped);

        Assert.NotNull(rig.Conductor.RetryIn);
    }

    [Fact]
    public void AnAttemptSaysReconnecting_UntilItActuallyHasAudio()
    {
        // Listening during a retry is the same untruth as Listening over a stall.
        var rig = new Rig();
        rig.StalledIntoARetry();

        rig.Reads(PlayerPhase.Stopped);
        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);

        rig.Reads(PlayerPhase.Opening);
        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);

        rig.Reads(PlayerPhase.Buffering);
        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);

        rig.Reads(PlayerPhase.Playing);
        Assert.Equal(ListeningState.Playing, rig.Conductor.State);
    }

    [Fact]
    public void ADeadConnectionEndsUnreachable_AndTheRetriesStop()
    {
        var rig = new Rig();
        rig.Stalled();

        // Every attempt hangs. A loop bound far past the five-minute budget, so a retry that went
        // unwatched fails this rather than hanging it.
        for (var second = 0; second < 2000 && rig.Conductor.State != ListeningState.Unreachable; second++)
        {
            rig.Time.Advance(TimeSpan.FromSeconds(1));
        }

        Assert.Equal(ListeningState.Unreachable, rig.Conductor.State);

        var reloads = rig.Reloads;
        rig.Time.Advance(TimeSpan.FromHours(1));
        Assert.Equal(reloads, rig.Reloads);
    }

    [Fact]
    public void RepeatedReadingsDoNotHoldTheLimitOff()
    {
        // A network player says the same thing on every poll.
        var rig = new Rig();
        rig.Stalled();

        for (var poll = 0; poll < 10; poll++)
        {
            rig.Time.Advance(TimeSpan.FromSeconds(1));
            rig.Reads(PlayerPhase.Buffering);
        }

        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);
    }

    [Fact]
    public void ReadingsDuringTheWaitForARetryDoNotCancelIt()
    {
        var rig = new Rig();
        rig.Stalled();
        rig.Time.Advance(PlaybackConductor.StallLimit);
        var wait = rig.Conductor.RetryIn;

        rig.Reads(PlayerPhase.Buffering);

        Assert.Equal(wait, rig.Conductor.RetryIn);
        Assert.Equal(ListeningState.Reconnecting, rig.Conductor.State);
        rig.Time.Advance(wait!.Value);
        Assert.Equal(1, rig.Reloads);
    }

    [Fact]
    public void RecoveringOnItsOwnAfterAStallCancelsTheRetry()
    {
        var rig = new Rig();
        rig.Stalled();
        rig.Time.Advance(PlaybackConductor.StallLimit);

        rig.Reads(PlayerPhase.Playing);
        rig.Time.Advance(TimeSpan.FromMinutes(1));

        Assert.Equal(ListeningState.Playing, rig.Conductor.State);
        Assert.Equal(0, rig.Reloads);
    }

    [Fact]
    public void StoppingEndsTheWatch()
    {
        var rig = new Rig();
        rig.Stalled();

        rig.Conductor.Released();
        rig.Time.Advance(TimeSpan.FromMinutes(1));

        Assert.Equal(ListeningState.Stopped, rig.Conductor.State);
        Assert.Null(rig.Conductor.RetryIn);
        Assert.Equal(0, rig.Reloads);
    }

    [Fact]
    public void AStopPressedAfterTheRetryFiredWinsOverIt()
    {
        // The retry is posted to the UI thread, so the stop can land first. The player must stay down.
        var time = new FakeTimeProvider();
        var conductor = new PlaybackConductor(time);
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Failed));
        time.Advance(conductor.RetryIn!.Value);

        conductor.Released();

        Assert.False(conductor.BeginRetry());
    }

    [Fact]
    public void AStallEventOvertakenByAudioIsIgnored()
    {
        // The same race from the other side: the limit ran out with Playing already on its way.
        var time = new FakeTimeProvider();
        var conductor = new PlaybackConductor(time);
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));
        conductor.Observed(new PlayerStatus(PlayerPhase.Buffering));
        time.Advance(PlaybackConductor.StallLimit);

        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));

        Assert.False(conductor.StallElapsed());
        Assert.Equal(ListeningState.Playing, conductor.State);
    }

    [Fact]
    public void AStallEventCannotCutALaterWaitShort()
    {
        var time = new FakeTimeProvider();
        var conductor = new PlaybackConductor(time);
        conductor.Requested();
        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));
        conductor.Observed(new PlayerStatus(PlayerPhase.Buffering));
        time.Advance(PlaybackConductor.StallLimit);

        conductor.Observed(new PlayerStatus(PlayerPhase.Playing));
        conductor.Observed(new PlayerStatus(PlayerPhase.Buffering));

        Assert.False(conductor.StallElapsed());
    }
}
