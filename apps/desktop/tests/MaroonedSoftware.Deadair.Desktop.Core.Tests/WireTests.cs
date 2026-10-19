using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// An enum as the station's word for it, including a word this build was generated too early to know.
/// </summary>
public class WireTests
{
    [Fact]
    public void AKnownValueIsTheStationsWord()
    {
        Assert.Equal("keen", Wire.Name<PersonaTrivia>(PersonaTrivia.Keen));
        Assert.Equal(PersonaTrivia.Never, Wire.Parse<PersonaTrivia>("never"));
    }

    [Fact]
    public void NoValueIsEmpty() => Assert.Equal(string.Empty, Wire.Name<PersonaTrivia>(null));

    [Fact]
    public void AValueThisBuildCannotSpellIsEmpty_RatherThanTakingThePageDown() =>
        Assert.Equal(string.Empty, Wire.Name<PersonaTrivia>(PersonaTrivia.Unknown));

    [Fact]
    public void AWordTheStationDoesNotUseParsesAsNothing() => Assert.Null(Wire.Parse<PersonaTrivia>("obsessive"));
}
