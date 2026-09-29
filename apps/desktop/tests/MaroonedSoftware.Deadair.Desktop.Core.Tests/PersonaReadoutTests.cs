using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What a character's dials come to, and which of its phrasings the station could never pick.
/// </summary>
/// <remarks>
/// Both are things an operator would otherwise find out by putting the character on air: a terse
/// character with no filter is two dropdowns that neither describes, and a phrasing naming a value
/// that does not exist is simply never chosen, which looks like nothing at all.
/// </remarks>
public class PersonaReadoutTests
{
    [Fact]
    public void AnUntouchedCharacterMakesOnePointAtTheUsualLength()
    {
        var sentence = PersonaReadout.Describe(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);

        Assert.StartsWith("Makes one point, in the station's usual length.", sentence, StringComparison.Ordinal);
    }

    [Fact]
    public void RoomWithoutBrevityRunsAsLongAsItTakes_AndBrevityStillWins()
    {
        Assert.Contains("as long as it takes", PersonaReadout.Describe(string.Empty, "loose", string.Empty, string.Empty, string.Empty), StringComparison.Ordinal);
        Assert.Contains("in one line", PersonaReadout.Describe("one-line", "unleashed", string.Empty, string.Empty, string.Empty), StringComparison.Ordinal);
    }

    [Fact]
    public void HowOftenItTalksIsSaidOnlyWhenItIsNotTheStationsOwn()
    {
        Assert.DoesNotContain("often as the station", PersonaReadout.Describe(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty), StringComparison.Ordinal);
        Assert.EndsWith("It talks half as often as the station would on its own.", PersonaReadout.Describe(string.Empty, string.Empty, string.Empty, "reserved", string.Empty), StringComparison.Ordinal);
    }

    [Fact]
    public void APhrasingNamingAValueTheStationCannotFillIsNamed()
    {
        Assert.Equal("names {{previous.tittle}}, which the station cannot fill in", PersonaReadout.FaultIn("That was {{previous.tittle}}"));
    }

    [Fact]
    public void ASingleBracketIsReadOut_ButADoubledOptionalPartIsFine()
    {
        Assert.NotNull(PersonaReadout.FaultIn("That was {{previous.title}} [live"));
        Assert.Null(PersonaReadout.FaultIn("That was {{previous.title}}.[[ Next, {{next.title}}.]]"));
    }

    [Fact]
    public void APhrasingNamingNoRecordSaysTheSameThingAfterEveryOne()
    {
        Assert.Equal("names no record, so it would say the same thing after every one", PersonaReadout.FaultIn("Stay where you are."));
    }

    [Fact]
    public void ALineSwitchedOffWithAHashIsNotChecked()
    {
        Assert.Empty(PersonaReadout.Faults("# Stay where you are.\n\nThat was {{previous.title}}."));
    }
}
