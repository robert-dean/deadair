using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// How a chart's place reads, from what a source may or may not keep.
/// </summary>
/// <remarks>
/// A chart source keeps a peak and a run only sometimes, and an album and year only sometimes. A row
/// that printed "peak  · wk" for a source that keeps neither would be a row reporting data nobody sent.
/// </remarks>
public class ChartPlaceTests
{
    [Fact]
    public void APlaceWithARunSaysBoth()
    {
        var place = ChartDetailViewModel.Place(new ChartRecord { Rank = 3, Title = "t", Artist = "a", Peak = 1, WeeksOn = 12 });

        Assert.Equal("3", place.Rank);
        Assert.Equal("peak 1 · 12 wk", place.Run);
    }

    [Fact]
    public void APlaceFromASourceThatKeepsNoRunSaysNothing()
    {
        var place = ChartDetailViewModel.Place(new ChartRecord { Rank = 1, Title = "t", Artist = "a" });

        Assert.Equal(string.Empty, place.Run);
        Assert.Null(place.Album);
    }

    [Fact]
    public void AFeaturedArtistIsNamed()
    {
        var place = ChartDetailViewModel.Place(new ChartRecord
        {
            Rank = 2,
            Title = "Die With A Smile",
            Artist = "Lady Gaga",
            Featuring = ["Bruno Mars"],
        });

        Assert.Equal("Lady Gaga feat. Bruno Mars", place.Artist);
    }

    [Theory]
    [InlineData("Ten", 1991L, "Ten, 1991")]
    [InlineData(null, 1991L, "1991")]
    [InlineData("Ten", null, "Ten")]
    public void TheAlbumAndYearAreJoinedOnlyWhenBothAreThere(string? album, long? year, string expected)
    {
        var place = ChartDetailViewModel.Place(new ChartRecord { Rank = 1, Title = "t", Artist = "a", Album = album, Year = year });

        Assert.Equal(expected, place.Album);
    }
}
