using MaroonedSoftware.Deadair.Desktop.Core.Playback;
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
}
