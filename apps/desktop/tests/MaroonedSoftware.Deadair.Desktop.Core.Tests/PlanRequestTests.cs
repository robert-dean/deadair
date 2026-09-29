using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What planning the station sends, and which characters may present it.
/// </summary>
/// <remarks>
/// Every absence here is a decision the station reads. An empty brief on a replan CLEARS the one the
/// broadcast carries, an absent one keeps it, and an unticked phone-in must send nothing because no
/// station-wide setting stands behind it. Getting one of those backwards changes what airs.
/// </remarks>
public class PlanRequestTests
{
    private static PlanForm Form(
        PlanScope scope = PlanScope.New,
        string brief = "Something with guitars",
        string? current = null,
        string from = "",
        string to = "",
        bool callins = false,
        string? persona = null) =>
        new(scope, brief, current, persona, from, to, callins, StationMode.Rotation, StationOnEnd.Extend);

    [Fact]
    public void AReplanWithTheBriefUntouchedSendsNoBrief()
    {
        var input = PlanRequest.Replan(Form(PlanScope.Keep, brief: "  warm and unhurried ", current: "warm and unhurried"));

        Assert.Null(input.Brief);
    }

    [Fact]
    public void AReplanWithTheBriefEmptiedClearsIt()
    {
        // Empty is the operator saying "go back to the ordinary rotation", which is a real instruction.
        var input = PlanRequest.Replan(Form(PlanScope.Keep, brief: "", current: "warm and unhurried"));

        Assert.Equal(string.Empty, input.Brief);
    }

    [Fact]
    public void AReplanSendsANewBriefTrimmed()
    {
        Assert.Equal("louder", PlanRequest.Replan(Form(PlanScope.Keep, brief: " louder ", current: "quiet")).Brief);
    }

    [Fact]
    public void KeepingTheShowIsAlwaysSendable_EvenWithNoBrief()
    {
        Assert.Null(PlanRequest.Problem(Form(PlanScope.Keep, brief: "")));
    }

    [Fact]
    public void ANewShowNeedsSomethingToPlay()
    {
        Assert.NotNull(PlanRequest.Problem(Form(brief: "   ")));
    }

    [Fact]
    public void ABriefIsCappedWhereTheContractCapsIt()
    {
        Assert.NotNull(PlanRequest.Problem(Form(brief: new string('a', PlanRequest.BriefMax + 1))));
        Assert.Null(PlanRequest.Problem(Form(brief: new string('a', PlanRequest.BriefMax))));
    }

    [Theory]
    [InlineData("197")]
    [InlineData("1979.5")]
    [InlineData("nineteen")]
    [InlineData("2200")]
    public void AYearThatIsNotAYearIsRefused(string year)
    {
        Assert.NotNull(PlanRequest.Problem(Form(from: year)));
    }

    [Fact]
    public void APeriodThatEndsBeforeItStartsIsRefused()
    {
        Assert.Equal("The period ends before it starts.", PlanRequest.Problem(Form(from: "1990", to: "1979")));
    }

    [Fact]
    public void ANewShowIsNamedAfterWhatItWasAskedFor()
    {
        var input = PlanRequest.PutOnAir(Form(brief: " heavy metal hits ", from: "1970", to: "1979", persona: "p1"));

        Assert.Equal("heavy metal hits", input.Brief);
        Assert.Equal("heavy metal hits", input.Name);
        Assert.Equal(1970, input.EraFrom);
        Assert.Equal(1979, input.EraTo);
        Assert.Equal("p1", input.PersonaId);
    }

    [Fact]
    public void EmptyBoundsAndNoHostAreSentAsAbsent()
    {
        var input = PlanRequest.PutOnAir(Form(persona: ""));

        Assert.Null(input.EraFrom);
        Assert.Null(input.EraTo);
        Assert.Null(input.PersonaId);
    }

    [Fact]
    public void CallsAreSentOnlyWhenAskedFor()
    {
        // Absent is no calls. Sending false would be harmless today and wrong the day a default
        // appears behind it, which is how a playlist once aired callers nobody asked for.
        Assert.Null(PlanRequest.PutOnAir(Form(callins: false)).Callins);
        Assert.True(PlanRequest.PutOnAir(Form(callins: true)).Callins);
    }

    [Fact]
    public void OnlyHostsArePresenters_AndAnUnstatedKindIsAHost()
    {
        static Persona Persona(string id, PersonaKind? kind) => new()
        {
            Id = id,
            Key = id,
            Kind = kind,
            Label = id,
            Style = string.Empty,
            DefaultHost = false,
            Presenting = false,
        };

        var hosts = Presenters.Of([Persona("a", PersonaKind.Host), Persona("b", PersonaKind.Caller), Persona("c", null)]);

        Assert.Equal(["a", "c"], hosts.Select(persona => persona.Id));
    }
}
