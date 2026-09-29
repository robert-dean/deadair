using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A character's sheet between the editor's boxes and what the station takes.
/// </summary>
/// <remarks>
/// Every rule here is one the station reads meaning into: an empty on-air name sent as "" names the
/// presenter nothing, a middle rung sent as a word is a stored value saying what absent already says,
/// and a key that moves under a rename detaches a character from everything it has said.
/// </remarks>
public class PersonaSheetTests
{
    [Fact]
    public void AnEmptyFieldIsLeftOutRatherThanSentEmpty()
    {
        var input = new PersonaSheet { Key = "k", Label = "L", Style = "s", DjName = "  ", Quirks = "\n \n" }.ToInput(PersonaKind.Host);

        Assert.Null(input.DjName);
        Assert.Null(input.Quirks);
    }

    [Fact]
    public void EveryListIsOneEntryPerLine_TrimmedWithBlankLinesDropped()
    {
        var input = new PersonaSheet { Key = "k", Label = "L", Style = "s", Diction = " Always contract \n\nSpeak to one person\n" }.ToInput(PersonaKind.Host);

        Assert.Equal(["Always contract", "Speak to one person"], input.Diction);
    }

    [Fact]
    public void TheMiddleRungOfEachDialIsSentAsAbsent()
    {
        var input = new PersonaSheet { Key = "k", Label = "L", Style = "s", Chattiness = "ordinary", Storytelling = "occasionally", Growth = "proposes" }
            .ToInput(PersonaKind.Host);

        Assert.Null(input.Chattiness);
        Assert.Null(input.Storytelling);
        Assert.Null(input.Growth);
    }

    [Fact]
    public void ADialIsSentAsTheStationsWord()
    {
        var input = new PersonaSheet { Key = "k", Label = "L", Style = "s", Brevity = "one-line", Growth = "self-directed" }.ToInput(PersonaKind.Host);

        Assert.Equal(PersonaBrevity.OneLine, input.Brevity);
        Assert.Equal(PersonaGrowth.SelfDirected, input.Growth);
    }

    [Fact]
    public void ASavedCharacterReadsBackTheWordsItWasSavedWith()
    {
        var sheet = PersonaSheet.From(new Persona
        {
            Id = "1",
            Key = "marla",
            Label = "Marla",
            Style = "dry",
            Brevity = PersonaBrevity.OneLine,
            Chattiness = PersonaChattiness.Ordinary,
            Quirks = ["one", "two"],
            DefaultHost = false,
            Presenting = false,
        });

        Assert.Equal("one-line", sheet.Brevity);
        Assert.Equal(string.Empty, sheet.Chattiness);
        Assert.Equal("one\ntwo", sheet.Quirks);
    }

    [Fact]
    public void OnlyACallerRingsIn_SoAHostsTiesAreNeverSent()
    {
        var sheet = new PersonaSheet { Key = "k", Label = "L", Style = "s", Hosts = ["h1"] };

        Assert.Null(sheet.ToInput(PersonaKind.Host).Hosts);
        Assert.Equal(["h1"], sheet.ToInput(PersonaKind.Caller).Hosts);
    }

    [Theory]
    [InlineData("Late-night Companion", "late-night-companion")]
    [InlineData("  The DJ!! ", "the-dj")]
    [InlineData("Zoë 2000", "zo-2000")]
    [InlineData("---", "")]
    public void AKeyIsTheNameAsASlug(string name, string key) => Assert.Equal(key, PersonaSheet.KeyFor(name));

    [Fact]
    public void ASaveNeedsANameAKeyAndWhoTheyAre_AskedInTheOrderTheyAreDrawn()
    {
        Assert.Equal("A persona needs a name.", new PersonaSheet().Problem());
        Assert.Equal("A persona needs a key.", new PersonaSheet { Label = "L" }.Problem());
        Assert.Equal("Say who this character is.", new PersonaSheet { Label = "L", Key = "k" }.Problem());
        Assert.Null(new PersonaSheet { Label = "L", Key = "k", Style = "s" }.Problem());
    }

    [Fact]
    public void TwoSheetsWithTheSameTiesAreTheSame_WhateverListHoldsThem()
    {
        var one = new PersonaSheet { Label = "L", Hosts = ["a", "b"] };
        var two = new PersonaSheet { Label = "L", Hosts = new List<string> { "b", "a" } };

        Assert.True(one.SameAs(two));
        Assert.False(one.SameAs(two with { Label = "M" }));
    }

    [Fact]
    public void AMarkerTheSamplesNeverUseIsNamed_AndNothingIsSaidWithNoSamples()
    {
        var sheet = new PersonaSheet { DictionMarkers = "aye\nin'", Samples = "I was talkin' to the harbour master" };

        Assert.Equal(["aye"], sheet.UnusedMarkers());
        Assert.Empty((sheet with { Samples = string.Empty }).UnusedMarkers());
    }
}
