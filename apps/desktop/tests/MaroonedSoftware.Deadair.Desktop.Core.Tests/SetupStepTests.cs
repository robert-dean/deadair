using MaroonedSoftware.Deadair.Desktop.Core.Station;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class SetupStepTests
{
    [Fact]
    public void AFirstRunOpensOnTheWelcome() => Assert.Equal(SetupStep.Welcome, SetupSteps.Initial(asking: false));

    /// <summary>A link has chosen the station and put it in the box, so the welcome would hide it.</summary>
    [Fact]
    public void BeingAskedForAStationOpensOnTheAddress() => Assert.Equal(SetupStep.Station, SetupSteps.Initial(asking: true));
}
