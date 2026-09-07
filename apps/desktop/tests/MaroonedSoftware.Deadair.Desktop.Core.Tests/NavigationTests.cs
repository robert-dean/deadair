using MaroonedSoftware.Deadair.Desktop.Navigation;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Which destinations an account can reach.
/// </summary>
/// <remarks>
/// Lives here rather than beside the view models because the rule is about the station's account
/// model rather than about Avalonia: listening is accountless, so the pages a listener can use must
/// be reachable with no session at all.
/// </remarks>
public class NavigationTests
{
    [Fact]
    public void TheDeskAndTheHistoryNeedNoAccount()
    {
        // Listening is accountless and stays that way. Somebody who heard something twenty minutes
        // ago and wants its name should not have to sign in to find out.
        var open = Destinations.All.Where(entry => !entry.NeedsOperator).Select(entry => entry.Label);

        Assert.Contains("Desk", open, StringComparer.Ordinal);
        Assert.Contains("History", open, StringComparer.Ordinal);
    }

    [Fact]
    public void ThePagesThatOnlyReadOperatorEndpointsAskForAnAccount()
    {
        var gated = Destinations.All.Where(entry => entry.NeedsOperator).Select(entry => entry.Label);

        Assert.Contains("Programme", gated, StringComparer.Ordinal);
        Assert.Contains("Library", gated, StringComparer.Ordinal);
    }

    [Fact]
    public void EveryDestinationHasItsOwnShortcut()
    {
        var keys = Destinations.All.Select(entry => entry.Key).ToList();

        Assert.Equal(keys.Count, keys.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void TheFirstDestinationWorksWithNoAccount()
    {
        // Whatever the rail opens on has to be reachable by somebody who has not signed in, or the
        // app starts on an empty page.
        Assert.False(Destinations.All[0].NeedsOperator);
    }
}
