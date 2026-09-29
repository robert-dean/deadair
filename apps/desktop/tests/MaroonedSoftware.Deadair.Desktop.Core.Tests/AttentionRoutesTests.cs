using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Where each thing needing a person can be dealt with, and which sidebar entry it badges.
/// </summary>
/// <remarks>
/// The station sends a path written for the web console's pages. Translating it here keeps the
/// station's words stable while this app's pages move, and the one table feeds both the desk's links
/// and the sidebar's counts, so a badge and the row behind it cannot disagree about where a fault
/// belongs. An unknown path must link nowhere rather than somewhere wrong.
/// </remarks>
public class AttentionRoutesTests
{
    private static AttentionItem Item(string route, AttentionItemSeverity severity) => new()
    {
        Code = route,
        Severity = severity,
        Title = route,
        Detail = route,
        Route = route,
    };

    [Theory]
    [InlineData("/onair", AttentionPage.Desk)]
    [InlineData("/personas", AttentionPage.Voice)]
    [InlineData("/schedule", AttentionPage.Programme)]
    [InlineData("/catalog", AttentionPage.Library)]
    [InlineData("/catalog?state=benched", AttentionPage.Library)]
    [InlineData("/catalog/tracks/0f8fad5b-d9cb-469f-a165-70867728950e", AttentionPage.Library)]
    [InlineData("/plugins", AttentionPage.Settings)]
    [InlineData("/plugins/spotify", AttentionPage.Settings)]
    [InlineData("/settings", AttentionPage.Settings)]
    public void EachRouteTheStationSendsLandsOnThePageThatCanDealWithIt(string route, AttentionPage page)
    {
        Assert.Equal(page, AttentionRoutes.PageOf(route));
    }

    [Theory]
    [InlineData("/somewhere-new")]
    [InlineData("/catalog/tracks/not-a-record")]
    [InlineData("")]
    [InlineData(null)]
    public void AnUnknownRouteHasNoPage_RatherThanTheNearestOne(string? route)
    {
        Assert.Null(AttentionRoutes.PageOf(route));
    }

    [Fact]
    public void ARowIsCountedAgainstThePageItLinksTo_WithTheWorstSeverityThere()
    {
        var counts = AttentionRoutes.Counts(
        [
            Item("/plugins/spotify", AttentionItemSeverity.Notice),
            Item("/settings", AttentionItemSeverity.Failure),
            Item("/plugins", AttentionItemSeverity.Warning),
            Item("/personas", AttentionItemSeverity.Warning),
        ]);

        Assert.Equal(new AttentionCount(3, Severity.Failure), counts[AttentionPage.Settings]);
        Assert.Equal(new AttentionCount(1, Severity.Warning), counts[AttentionPage.Voice]);
    }

    [Fact]
    public void ARowWithNoPageBadgesNothing()
    {
        // It is still on the desk, which is the surface that has to be complete.
        var counts = AttentionRoutes.Counts([Item("/somewhere-new", AttentionItemSeverity.Failure)]);

        Assert.Empty(counts);
    }

    [Fact]
    public void EveryPageHasAName()
    {
        foreach (var page in Enum.GetValues<AttentionPage>())
        {
            Assert.False(string.IsNullOrWhiteSpace(AttentionRoutes.Label(page)));
        }
    }
}
