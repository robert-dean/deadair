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
    public void EveryDestinationNamesAnIconThatIsReallyThere()
    {
        // The icon is a resource KEY, so a typo is a blank square at run time rather than a compile
        // error. This reads the dictionary the application merges and asks it.
        var icons = File.ReadAllText(
            Path.Combine(Repository(), "src", "MaroonedSoftware.Deadair.Desktop", "Themes", "Icons.axaml"));

        foreach (var entry in Destinations.All)
        {
            Assert.Contains($"x:Key=\"{entry.Icon}\"", icons, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void TheSectionsAgreeWithTheAccountRuleRatherThanRestatingIt()
    {
        // A heading is the account rule said out loud: everything under Desk needs one, and nothing
        // under Listen or App does. A destination that disagreed would put a page somebody cannot
        // open under a heading promising they can.
        foreach (var entry in Destinations.All)
        {
            Assert.Equal(entry.Section is NavSection.Desk, entry.NeedsOperator);
        }
    }

    /// <summary>Walks up from the test binary to the `apps/desktop` directory.</summary>
    private static string Repository()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "src")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return directory.FullName;
    }

    [Fact]
    public void TheFirstDestinationWorksWithNoAccount()
    {
        // Whatever the rail opens on has to be reachable by somebody who has not signed in, or the
        // app starts on an empty page.
        Assert.False(Destinations.All[0].NeedsOperator);
    }
}
