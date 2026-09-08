using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Which plugins this app agrees to load, decided before any of their code is opened.
///
/// The check has to be exactly as strict as the contract really is. Too loose and a plugin passes
/// and then fails to load with a type error, which is the failure the check exists to replace; too
/// strict and a plugin that would have worked is refused for a digit.
/// </summary>
public sealed class ApiVersionRangeTests
{
    [Theory]
    [InlineData("^1.0.0", "1.0.0", true)]
    [InlineData("^1.0.0", "1.4.2", true)]
    [InlineData("^1.0.0", "2.0.0", false)]
    [InlineData("^1.2.0", "1.1.9", false)]
    public void ACaretAcceptsAnythingUpToTheNextMajor(string range, string version, bool allowed)
    {
        Assert.Null(ApiVersionRange.TryParse(range, out var parsed));
        Assert.NotNull(parsed);
        Assert.Equal(allowed, parsed.Allows(version));
    }

    /// <summary>
    /// Below 1.0.0 the MINOR is the breaking digit, which is npm's rule and the one people get
    /// wrong. A contract that has not reached 1.0 is one whose author is still moving things, and
    /// treating 0.3 and 0.4 as compatible would let a plugin load against a shape that changed.
    /// </summary>
    [Theory]
    [InlineData("^0.3.0", "0.3.0", true)]
    [InlineData("^0.3.0", "0.3.9", true)]
    [InlineData("^0.3.0", "0.4.0", false)]
    [InlineData("^0.3.0", "1.0.0", false)]
    public void BeforeOneTheMinorIsWhatBreaks(string range, string version, bool allowed)
    {
        Assert.Null(ApiVersionRange.TryParse(range, out var parsed));
        Assert.NotNull(parsed);
        Assert.Equal(allowed, parsed.Allows(version));
    }

    [Theory]
    [InlineData("1.2.0", "1.2.0", true)]
    [InlineData("1.2.0", "1.2.1", false)]
    [InlineData("1.2.0", "1.1.0", false)]
    public void AnExactVersionMeansThatVersion(string range, string version, bool allowed)
    {
        Assert.Null(ApiVersionRange.TryParse(range, out var parsed));
        Assert.NotNull(parsed);
        Assert.Equal(allowed, parsed.Allows(version));
    }

    [Theory]
    [InlineData(">=1.1.0", "1.1.0", true)]
    [InlineData(">=1.1.0", "9.9.9", true)]
    [InlineData(">=1.1.0", "1.0.9", false)]
    [InlineData(">=1.1.0 <2.0.0", "1.9.0", true)]
    [InlineData(">=1.1.0 <2.0.0", "2.0.0", false)]
    public void AFloorHasNoCeilingUnlessOneIsWritten(string range, string version, bool allowed)
    {
        Assert.Null(ApiVersionRange.TryParse(range, out var parsed));
        Assert.NotNull(parsed);
        Assert.Equal(allowed, parsed.Allows(version));
    }

    [Fact]
    public void AStarTakesAnything()
    {
        Assert.Null(ApiVersionRange.TryParse("*", out var parsed));
        Assert.NotNull(parsed);
        Assert.True(parsed.Allows("0.0.1"));
        Assert.True(parsed.Allows("99.0.0"));
    }

    /// <summary>
    /// A range nobody can read is a plugin nobody can decide about, and the safe answer is to refuse
    /// it: loading it anyway would mean the compatibility check passed for exactly the plugin whose
    /// compatibility is least known. The message names the text, so it can be fixed.
    /// </summary>
    [Theory]
    [InlineData("~1.0.0")]
    [InlineData("1.x")]
    [InlineData("^1.0")]
    [InlineData("latest")]
    [InlineData("")]
    [InlineData(null)]
    public void ARangeThisAppCannotReadIsRefusedRatherThanGuessedAt(string? range)
    {
        var problem = ApiVersionRange.TryParse(range, out var parsed);

        Assert.NotNull(problem);
        Assert.Null(parsed);
    }

    /// <summary>
    /// Two parts is the trap: <c>Version</c> itself parses "1.0" happily and gives it a Build of -1,
    /// which compares below every real version and would quietly make a plugin look older than it is.
    /// </summary>
    [Fact]
    public void AVersionWithTwoPartsIsNotAVersion()
    {
        Assert.Null(ApiVersionRange.TryParse("^1.0.0", out var parsed));
        Assert.NotNull(parsed);
        Assert.False(parsed.Allows("1.0"));
    }

    [Fact]
    public void TheAppsOwnVersionSatisfiesTheRangeAPluginWouldNaturallyWrite()
    {
        Assert.Null(ApiVersionRange.TryParse("^1.0.0", out var parsed));
        Assert.NotNull(parsed);
        Assert.True(parsed.Allows(PluginSdk.PluginApi.Version));
    }
}
