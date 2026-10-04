using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What the state filter counts, and why an empty list is empty.
/// </summary>
/// <remarks>
/// Two of the chips count the complement of what the station sends, and getting that backwards puts
/// "412 Not fetched" on a library where 412 are held. An empty list has three causes and only one is
/// a problem: reading "the catalog is empty" over eight hundred records because nothing is benched
/// was the good news wearing the bad news's words.
/// </remarks>
public class TrackStatesTests
{
    private static readonly TrackStateCounts Counts = new() { Total = 766, Cached = 412, Measured = 389, Enriched = 701, Benched = 3, Failing = 0, Lyrics = 0, Synced = 0, Instrumental = 0 };

    [Theory]
    [InlineData(TrackState.Cached, 412)]
    [InlineData(TrackState.Uncached, 354)]
    [InlineData(TrackState.Unmeasured, 377)]
    [InlineData(TrackState.Failing, 0)]
    [InlineData(TrackState.Benched, 3)]
    public void EachChipCountsWhatItFiltersTo(TrackState state, long expected) =>
        Assert.Equal(expected, TrackStates.Count(state, Counts));

    [Fact]
    public void EveryStateTheStationFiltersOnHasAChip() =>
        Assert.Equal(Enum.GetValues<TrackState>().Order(), TrackStates.All.Select(filter => filter.State).Order());

    [Fact]
    public void TheSentenceSaysHowMuchCanAirNow() =>
        Assert.Contains("of 766 records are ready to air right now.", TrackStates.Ready(Counts), StringComparison.Ordinal);

    [Fact]
    public void ASearchNothingMatchesIsATypoNotAnEmptyCatalog_EvenThoughItsTotalIsZero()
    {
        var said = TrackStates.NothingHere("pearl jan", TrackState.Benched, total: 0);

        Assert.StartsWith("Nothing matches “pearl jan”", said, StringComparison.Ordinal);
    }

    [Fact]
    public void AnEmptyCatalogIsSaidToBeEmpty() =>
        Assert.StartsWith("The catalog is empty", TrackStates.NothingHere(string.Empty, null, total: 0), StringComparison.Ordinal);

    [Fact]
    public void AFaultFilterThatMatchesNothingIsGoodNews() =>
        Assert.Equal("No record has had all its copies written off.", TrackStates.NothingHere(null, TrackState.Benched, total: 766));
}
