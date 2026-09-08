using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public sealed class ClockFormatTests
{
    [Fact]
    public void WritesMinutesAndSecondsForAnOrdinaryRecord()
    {
        Assert.Equal("3:58", ClockFormat.Elapsed(TimeSpan.FromSeconds(238)));
    }

    [Fact]
    public void PadsTheSecondsButNotTheMinutes()
    {
        // 3:08 rather than 3:8, and 3 rather than 03: a leading zero on the minutes would make a
        // four-minute record look like an hour-long one at a glance.
        Assert.Equal("3:08", ClockFormat.Elapsed(TimeSpan.FromSeconds(188)));
    }

    [Fact]
    public void GrowsAnHourColumnOnlyWhenThereIsAnHour()
    {
        Assert.Equal("1:02:10", ClockFormat.Elapsed(TimeSpan.FromSeconds(3730)));
        Assert.Equal("59:59", ClockFormat.Elapsed(TimeSpan.FromSeconds(3599)));
    }

    [Fact]
    public void ClampsANegativeToZeroRatherThanWritingOne()
    {
        // Reachable: the projection re-anchors on every reading, and a station whose clock has moved
        // backwards between two of them can hand this a negative remainder. "-0:03" would read as a
        // record that has already finished and still be counting.
        Assert.Equal("0:00", ClockFormat.Elapsed(TimeSpan.FromSeconds(-3)));
    }

    [Fact]
    public void CountsRemainingDownWithTheMinusInTheWord()
    {
        Assert.Equal("-1:46", ClockFormat.Remaining(TimeSpan.FromSeconds(106)));
    }

    [Fact]
    public void SaysNothingRatherThanZeroWhenTheStationCouldNotSay()
    {
        // The shape of a timecode, so the column does not resize when a real one arrives.
        Assert.Equal("--:--", ClockFormat.Unknown);
    }
}
