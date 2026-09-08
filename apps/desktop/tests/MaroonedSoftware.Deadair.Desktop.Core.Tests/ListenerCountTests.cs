using MaroonedSoftware.Deadair.Desktop.Core.Text;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public sealed class ListenerCountTests
{
    [Fact]
    public void SaysNobodyRatherThanZero()
    {
        // On an audience-gated station zero is the ordinary resting state, and a numeral there reads
        // as a failed reading rather than as a quiet studio.
        Assert.Equal("Nobody listening", ListenerCount.Label(0));
    }

    [Fact]
    public void UsesTheSingularForTheCountAnOperatorSeesMost()
    {
        Assert.Equal("1 listening", ListenerCount.Label(1));
    }

    [Fact]
    public void CountsTheRest()
    {
        Assert.Equal("12 listening", ListenerCount.Label(12));
    }

    [Fact]
    public void TreatsAnImpossibleNegativeAsNobody()
    {
        Assert.Equal("Nobody listening", ListenerCount.Label(-1));
    }
}
