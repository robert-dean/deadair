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
}
