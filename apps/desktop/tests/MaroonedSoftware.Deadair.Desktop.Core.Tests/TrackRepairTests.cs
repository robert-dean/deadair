using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What an operator can do about a record that will not play, and when the whole page gets it.
/// </summary>
/// <remarks>
/// A list-wide repair over a state that is not a fault would be a button whose worst case is
/// re-fetching a healthy library, so the bulk verb exists for exactly two states. And re-offering a
/// refused copy overrides a provider's own answer, so it is the one repair that must not be confused
/// with a retry.
/// </remarks>
public class TrackRepairTests
{
    [Theory]
    [InlineData(TrackState.Benched, TrackRepair.Offer)]
    [InlineData(TrackState.Failing, TrackRepair.Retry)]
    public void TheTwoFaultStatesEachHaveAPageWideRemedy(TrackState state, TrackRepair expected) =>
        Assert.Equal(expected, TrackRepairs.ForState(state));

    [Theory]
    [InlineData(TrackState.Cached)]
    [InlineData(TrackState.Uncached)]
    [InlineData(TrackState.Unmeasured)]
    [InlineData(null)]
    public void NoOtherStateIsOfferedOne(TrackState? state) => Assert.Null(TrackRepairs.ForState(state));

    [Fact]
    public void EveryRepairAsksWithASentenceAndAVerb()
    {
        foreach (var repair in TrackRepairs.All)
        {
            var words = TrackRepairs.Words(repair);
            Assert.False(string.IsNullOrWhiteSpace(words.Consequence));
            Assert.EndsWith("?", words.Question, StringComparison.Ordinal);
            Assert.False(string.IsNullOrWhiteSpace(words.Verb));
        }
    }

    [Fact]
    public void OnlyTheThreeClearsAreDrawnAsDestructive()
    {
        Assert.Equal(
            [TrackRepair.Audio, TrackRepair.Analysis, TrackRepair.Enrichment],
            TrackRepairs.All.Where(TrackRepairer.Destroys));
    }

    [Fact]
    public void ThePageWideConfirmationSaysHowManyRecordsItActsOn() =>
        Assert.Contains("the 12 records on this page", TrackRepairs.Bulk(TrackRepair.Retry, 12).Consequence, StringComparison.Ordinal);

    [Theory]
    [InlineData(12, 0, "12 records reopened.")]
    [InlineData(1, 0, "1 record reopened.")]
    [InlineData(10, 2, "10 records reopened, 2 the station would not act on.")]
    public void TheOutcomeCountsWhatWasRefusedApart(int done, int refused, string expected) =>
        Assert.Equal(expected, TrackRepairs.Outcome(done, refused));
}
