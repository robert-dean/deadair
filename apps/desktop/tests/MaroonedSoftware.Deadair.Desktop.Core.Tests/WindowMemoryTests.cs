using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using Xunit;
using ScreenArea = MaroonedSoftware.Deadair.Desktop.Core.Settings.WindowMemory.ScreenArea;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class WindowMemoryTests
{
    // In points, as macOS gives them: a 1512x945 laptop beside a 2560x1440 display to its right. Both
    // working areas start below the menu bar.
    private static readonly ScreenArea Laptop = new(0, 25, 1512, 920);
    private static readonly ScreenArea External = new(1512, 25, 2560, 1415);

    private static WindowMemory Frame(int x, int y, double width = 1180, double height = 720) =>
        new() { X = x, Y = y, Width = width, Height = height };

    [Fact]
    public void LandsOnTheScreenThatHoldsItsCentre()
    {
        Assert.True(WindowMemory.LandsOn(Frame(100, 100), [Laptop, External]));
        Assert.True(WindowMemory.LandsOn(Frame(2000, 100), [Laptop, External]));
    }

    /// <summary>
    /// Half on each display is an ordinary place to leave a window, and its centre is still on one
    /// of them, which is what decides it.
    /// </summary>
    [Fact]
    public void AWindowAcrossTwoScreensLandsOnTheOneHoldingItsCentre()
    {
        // Its centre is at 1100 + 590 = 1690, on the external display.
        Assert.True(WindowMemory.LandsOn(Frame(1100, 200), [Laptop, External]));
    }

    /// <summary>
    /// The case the render scaling would have got wrong: on the right half of a Retina laptop, whose
    /// scaling is 2, but whose desktop coordinates are points.
    /// </summary>
    [Fact]
    public void AWindowOnTheRightOfALaptopScreenLands()
    {
        // Centre at 700 + 590 = 1290, inside the laptop's 1512 points.
        Assert.True(WindowMemory.LandsOn(Frame(700, 100), [Laptop]));
    }

    [Fact]
    public void IsRefusedWhenItsCentreFallsOffEveryScreen()
    {
        Assert.False(WindowMemory.LandsOn(Frame(-3000, 200), [Laptop, External]));
        Assert.False(WindowMemory.LandsOn(Frame(200, 5000), [Laptop, External]));
    }

    /// <summary>
    /// The case this exists for: a laptop closed on an external display and opened again without it.
    /// </summary>
    [Fact]
    public void IsRefusedWhenTheScreenItWasOnIsGone()
    {
        Assert.False(WindowMemory.LandsOn(Frame(2000, 100), [Laptop]));
    }

    [Fact]
    public void IsRefusedWhenNothingIsConnected()
    {
        Assert.False(WindowMemory.LandsOn(Frame(200, 200), []));
    }

    /// <summary>
    /// Where desktop coordinates are pixels (Windows, at 2x), the same frame is twice as wide in them,
    /// so its centre is further right.
    /// </summary>
    [Fact]
    public void MeasuresTheSizeInDesktopUnits_WhereThoseArePixels()
    {
        var screen = new ScreenArea(0, 0, 1000, 1000);

        // Starting at 300: centre 890 at 1, 1480 at 2.
        Assert.True(WindowMemory.LandsOn(Frame(300, 0), [screen], desktopScaling: 1));
        Assert.False(WindowMemory.LandsOn(Frame(300, 0), [screen], desktopScaling: 2));
    }

    [Theory]
    [InlineData(double.NaN, 720)]
    [InlineData(1180, double.PositiveInfinity)]
    [InlineData(0, 720)]
    [InlineData(1180, -1)]
    public void IsRefusedWhenASizeIsNotANumber(double width, double height)
    {
        Assert.False(WindowMemory.LandsOn(Frame(200, 200, width, height), [Laptop]));
    }
}
