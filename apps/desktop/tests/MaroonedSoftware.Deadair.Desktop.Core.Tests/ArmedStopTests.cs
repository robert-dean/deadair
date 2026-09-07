using MaroonedSoftware.Deadair.Desktop.Core.Playout;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class ArmedStopTests
{
    [Fact]
    public void TheFirstPressArmsAndTheSecondActs()
    {
        var stop = new ArmedStop();

        Assert.False(stop.Press());
        Assert.True(stop.IsArmed());
        Assert.True(stop.Press());
    }

    [Fact]
    public void DisarmsItselfAfterAWhile()
    {
        // A half-pressed Stop that nobody meant must not sit there waiting to be completed by an
        // unrelated click a minute later.
        var time = new FakeTimeProvider();
        var stop = new ArmedStop(time);

        Assert.False(stop.Press());
        time.Advance(TimeSpan.FromSeconds(6));

        Assert.False(stop.IsArmed());
        Assert.False(stop.Press());
    }

    [Fact]
    public void StaysArmedInsideTheWindow()
    {
        var time = new FakeTimeProvider();
        var stop = new ArmedStop(time);

        stop.Press();
        time.Advance(TimeSpan.FromSeconds(3));

        Assert.True(stop.Press());
    }

    [Fact]
    public void ActingOnceDoesNotLeaveItArmedForANextTime()
    {
        var stop = new ArmedStop();
        stop.Press();
        Assert.True(stop.Press());

        // Otherwise a third press would take the station off air with no warning at all.
        Assert.False(stop.IsArmed());
        Assert.False(stop.Press());
    }
}
