using MaroonedSoftware.Deadair.Desktop.Core.Net;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class AppVersionTests
{
    /// <summary>
    /// Every build in a git checkout is stamped this way by the SDK, so without the strip the
    /// User-Agent would change with every commit and a station's logs would see a new client each time.
    /// </summary>
    [Fact]
    public void StripsTheRevisionTheSdkAppendsAfterThePlus()
    {
        Assert.Equal("0.1.0", AppVersion.Strip("0.1.0+229fad36c2b1e0f4a8d9e3b7c6a5f4e3d2c1b0a9"));
    }

    [Fact]
    public void KeepsAPrereleaseSuffix_BecauseItIsPartOfTheVersion()
    {
        Assert.Equal("0.3.0-beta.1", AppVersion.Strip("0.3.0-beta.1+abc123"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("+abc123")]
    public void AnswersZeroZeroZeroWhenNothingStampedTheBuild(string? informational)
    {
        Assert.Equal(AppVersion.Unknown, AppVersion.Strip(informational));
    }

    [Fact]
    public void ComparesAPrereleaseByItsReleaseNumber()
    {
        Assert.Equal(new Version(0, 3, 0), AppVersion.ToNumber("0.3.0-beta.1"));
        Assert.Equal(new Version(0, 0, 0), AppVersion.ToNumber("not a version"));
    }

    [Fact]
    public void TheUserAgentNamesTheAppAndCarriesNoRevision()
    {
        Assert.Equal("deadair-desktop/" + AppVersion.Current, UserAgent.Value);
        Assert.DoesNotContain('+', UserAgent.Value);
        Assert.NotEqual(AppVersion.Unknown, AppVersion.Current);
    }
}
