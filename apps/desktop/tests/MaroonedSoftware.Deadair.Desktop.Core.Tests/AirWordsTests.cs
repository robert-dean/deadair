using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What the desk says about who is driving the station, and whether the schedule may take it back.
/// </summary>
/// <remarks>
/// An operator's own choice holds until the next block begins, so "the clock is driving" and "you
/// are" can each be true for an hour with nothing on the screen telling them apart. These words are
/// the only thing that does, and a hold nobody can see is worse than none.
/// </remarks>
public class AirWordsTests
{
    [Theory]
    [InlineData(AirSource.Operator, "You put this on")]
    [InlineData(AirSource.Sustaining, "Between blocks")]
    [InlineData(AirSource.Schedule, "The schedule put this on")]
    public void EachSourceIsSaidWithASubject(AirSource source, string words)
    {
        Assert.Equal(words, AirWords.Driving(source));
        Assert.NotNull(AirWords.DrivingHint(source));
    }

    [Fact]
    public void AStoodDownStationHasNobodyDrivingIt()
    {
        Assert.Null(AirWords.Driving(AirSource.Off));
        Assert.Null(AirWords.DrivingHint(AirSource.Off));
    }

    [Fact]
    public void TheHoldIsOfferedOnlyWhileAPersonIsDriving()
    {
        // Holding the schedule off a block the schedule itself put on is not a thing to want.
        Assert.True(AirWords.OffersHold(AirSource.Operator, held: false));
        Assert.False(AirWords.OffersHold(AirSource.Schedule, held: false));
        Assert.False(AirWords.OffersHold(AirSource.Sustaining, held: false));
    }

    [Fact]
    public void AHeldStationIsAlwaysOfferedItsRelease_WhateverTheSourceSays()
    {
        // A hold that cannot be seen is worse than no hold, so the way out is never hidden.
        Assert.True(AirWords.OffersHold(AirSource.Schedule, held: true));
    }

    [Fact]
    public void AnUnheldBroadcastSaysTheScheduleTakesItBack()
    {
        Assert.Equal("The schedule takes this back at the next block.", AirWords.Hold(held: false, holdUntil: null));
    }

    [Fact]
    public void AHoldWithNoEndIsAStateRatherThanAMissingTime()
    {
        // JSON cannot carry infinity, so the station says "until released" by leaving the time out.
        Assert.StartsWith("Held until you release it.", AirWords.Hold(held: true, holdUntil: null), StringComparison.Ordinal);
    }

    [Fact]
    public void AHoldWithAnEndSaysWhenOnTheMacsOwnClock()
    {
        var until = new DateTimeOffset(2026, 9, 29, 14, 30, 0, TimeSpan.Zero);
        var expected = until.ToLocalTime().ToString("t", CultureInfo.InvariantCulture);

        Assert.Equal(
            $"Held until about {expected}.",
            AirWords.Hold(true, until.ToString("O", CultureInfo.InvariantCulture), CultureInfo.InvariantCulture));
    }

    [Fact]
    public void AnEndTheStationWroteBadlyIsSaidAsTheOpenHold()
    {
        Assert.StartsWith("Held until you release it.", AirWords.Hold(true, "not a time"), StringComparison.Ordinal);
    }

    [Fact]
    public void EveryAirModeSaysWhatChangingToItDoes()
    {
        Assert.NotEqual(AirWords.ModeConsequence(AirMode.Always), AirWords.ModeConsequence(AirMode.Audience));
        Assert.Equal("always", AirWords.Mode(AirMode.Always));
        Assert.Equal("when somebody is listening", AirWords.Mode(AirMode.Audience));
    }
}
