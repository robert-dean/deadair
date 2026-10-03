using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class StudioScreenTests
{
    [Fact]
    public void TakesTheScreenAndGivesBackTheFrameItTookItFrom()
    {
        var screen = new StudioScreen();

        Assert.Equal(WindowShape.FullScreen, screen.Enter(WindowShape.Maximized));
        screen.Moved(WindowShape.FullScreen);

        Assert.Equal(WindowShape.Maximized, screen.Leave(WindowShape.FullScreen));
        Assert.False(screen.Took);
    }

    [Fact]
    public void LeavesAWindowThatWasAlreadyFullScreenAsItWas()
    {
        var screen = new StudioScreen();

        Assert.Null(screen.Enter(WindowShape.FullScreen));
        Assert.Null(screen.Leave(WindowShape.FullScreen));
    }

    [Fact]
    public void TheScreenIsTheirsOnceTheyLeaveFullScreenThemselves()
    {
        var screen = new StudioScreen();
        screen.Enter(WindowShape.Normal);
        screen.Moved(WindowShape.FullScreen);

        // The green button, with Studio still up.
        screen.Moved(WindowShape.Normal);

        Assert.False(screen.Took);
        Assert.Null(screen.Leave(WindowShape.Normal));
    }

    [Fact]
    public void AMinimisedWindowComesBackAsAnOrdinaryOne()
    {
        var screen = new StudioScreen();
        screen.Enter(WindowShape.Minimized);

        Assert.Equal(WindowShape.Normal, screen.Leave(WindowShape.FullScreen));
    }

    [Fact]
    public void LeavingTwiceGivesBackOnce()
    {
        var screen = new StudioScreen();
        screen.Enter(WindowShape.Normal);

        Assert.Equal(WindowShape.Normal, screen.Leave(WindowShape.FullScreen));
        Assert.Null(screen.Leave(WindowShape.FullScreen));
    }
}
