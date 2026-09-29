using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The words around what a character has accumulated.
/// </summary>
/// <remarks>
/// A rollback costs two things an operator would not expect, and they are said before the button that
/// does it or not at all. A story's next part has to land after the last one without renumbering
/// anything. And the presenter name reaches the hosts that have no name of their own, named, because
/// "one host" leaves somebody to work out which.
/// </remarks>
public class PersonaMemoryTextTests
{
    [Fact]
    public void ARollbackThatUndoesNothingSaysSo()
    {
        var change = new PersonaMemoryChange { Tellings = 0, Notes = 0, Stories = 0, Details = 0, Rejected = 0, Touched = 0 };

        Assert.Equal(["There is nothing after that moment to undo."], PersonaMemoryText.Summary(change));
    }

    [Fact]
    public void ARollbackCountsWhatGoes_AndNamesBothCostsNobodyExpects()
    {
        var change = new PersonaMemoryChange { Tellings = 3, Notes = 1, Stories = 0, Details = 2, Rejected = 1, Touched = 2 };

        var lines = PersonaMemoryText.Summary(change);

        Assert.Equal("3 tellings forgotten · 1 note · 2 details", lines[0]);
        Assert.Contains(lines, line => line.StartsWith("One of them was a proposal you turned down", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.StartsWith("2 of them you had accepted or edited", StringComparison.Ordinal));
    }

    [Fact]
    public void TheNextPartGoesTenAfterTheLast_IgnoringOnesTurnedDown()
    {
        PersonaStoryBeat Beat(long ordinal, PersonaStoryBeatState state) => new()
        {
            Id = $"b{ordinal}", StoryId = "s", Ordinal = ordinal, Beat = "b", State = state, Origin = PersonaStoryBeatOrigin.Operator, CreatedAt = "x",
        };

        Assert.Equal(10, PersonaMemoryText.NextOrdinal([]));
        Assert.Equal(30, PersonaMemoryText.NextOrdinal([Beat(10, PersonaStoryBeatState.Active), Beat(20, PersonaStoryBeatState.Suggested), Beat(90, PersonaStoryBeatState.Rejected)]));
    }

    [Fact]
    public void ThePresenterNameNamesTheHostsItReaches()
    {
        Assert.Equal("Marla goes by Night Desk on air, having no name of its own.", PersonaMemoryText.PresenterName("Night Desk", ["Marla"]));
        Assert.StartsWith("Every host here has a name of its own, so Night Desk", PersonaMemoryText.PresenterName("Night Desk", []), StringComparison.Ordinal);
        Assert.StartsWith("Marla, Dennis have no name on air", PersonaMemoryText.PresenterName(" ", ["Marla", "Dennis"]), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(40, "40 minutes")]
    [InlineData(60, "an hour")]
    [InlineData(180, "3 hours")]
    public void TheStoryWaitIsSaidTheWayAPersonWouldSayIt(long minutes, string said) =>
        Assert.Contains(said, PersonaMemoryText.StoryWait(minutes), StringComparison.Ordinal);

    [Fact]
    public void AMomentThatIsNotATimeIsShownAsSent()
    {
        Assert.Equal("yesterday", PersonaMemoryText.Moment("yesterday"));
    }
}
