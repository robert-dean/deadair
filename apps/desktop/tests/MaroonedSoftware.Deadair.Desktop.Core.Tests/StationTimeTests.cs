using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The station's clock as text, both ways.
/// </summary>
/// <remarks>
/// A slot's times are minutes past midnight and its moments are zone-less readings. Getting either
/// conversion wrong is a schedule that shows one time and fires at another, or a late show drawn as
/// ending before it starts.
/// </remarks>
public class StationTimeTests
{
    [Theory]
    [InlineData(0L, "00:00")]
    [InlineData(360L, "06:00")]
    [InlineData(1439L, "23:59")]
    public void MinutesReadAsAClock(long minutes, string expected) => Assert.Equal(expected, StationTime.Clock(minutes));

    [Theory]
    [InlineData(0L)]
    [InlineData(1440L)]
    public void AnEndAtMidnightIsTheFarEndOfTheDay_NotTheNearOne(long minutes) => Assert.Equal("24:00", StationTime.EndClock(minutes));

    [Fact]
    public void AnyOtherEndReadsAsItsClock() => Assert.Equal("10:00", StationTime.EndClock(600));

    [Theory]
    [InlineData("06:00", 360)]
    [InlineData("6:00", 360)]
    [InlineData(" 23:59 ", 1439)]
    public void AClockReadsAsMinutes(string text, int expected) => Assert.Equal(expected, StationTime.ParseClock(text));

    [Theory]
    [InlineData("24:00")]
    [InlineData("12:60")]
    [InlineData("25:00")]
    [InlineData("6")]
    [InlineData("06:0")]
    [InlineData("-1:00")]
    [InlineData("")]
    [InlineData(null)]
    public void AnythingThatIsNotATimeIsRefused_RatherThanCoerced(string? text) => Assert.Null(StationTime.ParseClock(text));

    [Fact]
    public void AnEndOfTwentyFourHundredIsSentAsZero_BecauseTheStationStopsAt1439() =>
        Assert.Equal(0, StationTime.ParseClock("24:00", end: true));

    [Fact]
    public void MinutesBetweenIsASubtractionOfTwoReadings() =>
        Assert.Equal(108, StationTime.MinutesBetween("2026-09-30 10:00:00", "2026-09-30 11:48:00"));

    [Fact]
    public void AReadingAcrossMidnightStillSubtracts() =>
        Assert.Equal(90, StationTime.MinutesBetween("2026-09-30 23:00:00", "2026-10-01 00:30:00"));

    [Fact]
    public void AnUnreadableReadingIsNoTimeAtAll() => Assert.Equal(0, StationTime.MinutesBetween("soon", "2026-09-30 11:48:00"));

    [Fact]
    public void ABlockReadsAsItsWeekdayAndHours() =>
        Assert.Equal("Wed 06:00–10:00", StationTime.When("2026-09-30 06:00:00", "2026-09-30 10:00:00"));

    [Fact]
    public void ABlockEndingAtMidnightEndsAtTwentyFourHundred() =>
        Assert.Equal("Wed 22:00–24:00", StationTime.When("2026-09-30 22:00:00", "2026-10-01 00:00:00"));

    [Theory]
    [InlineData(0, "ending")]
    [InlineData(-3, "ending")]
    [InlineData(12, "12 min")]
    [InlineData(60, "1 h")]
    [InlineData(125, "2 h 5 min")]
    [InlineData(1440, "a day")]
    [InlineData(6 * 1440, "6 days")]
    public void ASpanCoarsensAsItGrows(int minutes, string expected) => Assert.Equal(expected, StationTime.Span(minutes));
}
