using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>When Studio holds the display awake. The Android app's <c>KeepAwakeTest</c>, case for case.</summary>
public class KeepAwakeTests
{
    [Fact]
    public void NeverHoldsItWhateverElseIsTrue() =>
        Assert.False(KeepAwakeRule.Holds(KeepAwake.Never, onPower: true, playing: true, inFront: true));

    [Fact]
    public void AlwaysHoldsItOnTheBattery() =>
        Assert.True(KeepAwakeRule.Holds(KeepAwake.Always, onPower: false, playing: true, inFront: true));

    [Fact]
    public void WhileChargingHoldsItOnPower() =>
        Assert.True(KeepAwakeRule.Holds(KeepAwake.WhileCharging, onPower: true, playing: true, inFront: true));

    [Fact]
    public void WhileChargingLetsItSleepOnTheBattery() =>
        Assert.False(KeepAwakeRule.Holds(KeepAwake.WhileCharging, onPower: false, playing: true, inFront: true));

    [Fact]
    public void NothingPlayingLetsItSleepEvenSetToAlways() =>
        Assert.False(KeepAwakeRule.Holds(KeepAwake.Always, onPower: true, playing: false, inFront: true));

    [Fact]
    public void StudioDownOrUnseenLetsItSleepEvenSetToAlways() =>
        Assert.False(KeepAwakeRule.Holds(KeepAwake.Always, onPower: true, playing: true, inFront: false));

    [Fact]
    public void StartsAtNever() => Assert.Equal(KeepAwake.Never, new DesktopSettings().KeepAwake);
}
