using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// How a chart is named in the list and a story reads as a row.
/// </summary>
/// <remarks>
/// Two chart plugins can offer charts with the same name for different countries, and a list that
/// dropped the country would offer two identical rows. A story's link comes from a publisher, so only
/// a web address is drawn as one.
/// </remarks>
public class NewsAndChartsTests
{
    [Theory]
    [InlineData(null, null, "Top 40")]
    [InlineData("GB", null, "Top 40 (GB)")]
    [InlineData("GB", "rock", "Top 40 (GB, rock)")]
    public void AChartIsNamedWithWhereAndWhatItCovers(string? country, string? genre, string expected) =>
        Assert.Equal(expected, ChartRowViewModel.Label(new StationChart { Id = "x", PluginId = "p", Name = "Top 40", Country = country, Genre = genre }));

    [Fact]
    public void AStoryCarriesTheFeedsCategoryAndThePublishersOwn()
    {
        var row = NewsViewModel.Row(
            new NewsStory { Id = "1", FeedId = "f", FeedName = "Pitchfork", Title = "t", Categories = ["reissues"] },
            category: "Music");

        Assert.Equal("Music · reissues", row.Tags);
    }

    [Theory]
    [InlineData("https://example.org/story", true)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData(null, false)]
    public void OnlyAWebAddressIsALink(string? url, bool linked) =>
        Assert.Equal(linked, NewsViewModel.Row(new NewsStory { Id = "1", FeedId = "f", FeedName = "n", Title = "t", Url = url }, null).HasUrl);

    [Fact]
    public void ATimeThatDoesNotParseIsShownAsSent() => Assert.Equal("last Tuesday", NewsViewModel.When("last Tuesday"));
}
