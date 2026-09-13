using Avalonia.Controls;
using MaroonedSoftware.Deadair.Desktop.Services;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The one rule that turns a close into a hide, pinned because getting it wide would stop the app
/// quitting at all: every way out of an Avalonia app closes the window on its way.
/// </summary>
public class WindowKeeperTests
{
    [Fact]
    public void TheirOwnCloseHidesTheWindow()
    {
        Assert.True(WindowKeeper.HidesInsteadOfClosing(WindowCloseReason.WindowClosing, isProgrammatic: false));
    }

    [Theory]
    [InlineData(WindowCloseReason.ApplicationShutdown, false)]
    [InlineData(WindowCloseReason.OSShutdown, false)]
    [InlineData(WindowCloseReason.WindowClosing, true)]
    [InlineData(WindowCloseReason.OwnerWindowClosing, false)]
    public void QuittingOrCodeClosingItReallyCloses(WindowCloseReason reason, bool isProgrammatic)
    {
        Assert.False(WindowKeeper.HidesInsteadOfClosing(reason, isProgrammatic));
    }
}
