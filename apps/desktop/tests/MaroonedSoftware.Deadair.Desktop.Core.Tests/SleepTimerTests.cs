using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class SleepTimerTests
{
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 9, 13, 23, 0, 0, TimeSpan.Zero));

    [Fact]
    public void ElapsesOnceWhenTheTimeIsUp_AndNotBefore()
    {
        using var sleep = new SleepTimer(_time);
        var elapsed = 0;
        sleep.Elapsed += () => elapsed++;

        sleep.Set(TimeSpan.FromMinutes(30));

        _time.Advance(TimeSpan.FromMinutes(29));
        Assert.Equal(0, elapsed);

        _time.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(1, elapsed);

        _time.Advance(TimeSpan.FromHours(2));
        Assert.Equal(1, elapsed);
    }

    [Fact]
    public void CancellingBeforeItElapsesMeansItNeverFires()
    {
        using var sleep = new SleepTimer(_time);
        var elapsed = 0;
        sleep.Elapsed += () => elapsed++;

        sleep.Set(TimeSpan.FromMinutes(15));
        _time.Advance(TimeSpan.FromMinutes(10));
        sleep.Cancel();
        _time.Advance(TimeSpan.FromMinutes(10));

        Assert.Equal(0, elapsed);
        Assert.False(sleep.IsSet);
    }

    /// <summary>
    /// Choosing 60 after 15 means an hour from now, not whichever comes first: two timers running at
    /// once would stop the listener at the time they had just changed their mind about.
    /// </summary>
    [Fact]
    public void SettingAgainReplacesTheOldDeadlineRatherThanKeepingBoth()
    {
        using var sleep = new SleepTimer(_time);
        var elapsed = 0;
        sleep.Elapsed += () => elapsed++;

        sleep.Set(TimeSpan.FromMinutes(15));
        sleep.Set(TimeSpan.FromMinutes(60));

        _time.Advance(TimeSpan.FromMinutes(16));
        Assert.Equal(0, elapsed);

        _time.Advance(TimeSpan.FromMinutes(44));
        Assert.Equal(1, elapsed);
    }

    [Fact]
    public void RemainingCountsDownFromWhatWasSet_AndIsNullWhenNothingIs()
    {
        using var sleep = new SleepTimer(_time);

        Assert.Null(sleep.Remaining());

        sleep.Set(TimeSpan.FromMinutes(45));
        _time.Advance(TimeSpan.FromMinutes(5));

        Assert.Equal(TimeSpan.FromMinutes(40), sleep.Remaining());
        Assert.Equal(_time.GetUtcNow() + TimeSpan.FromMinutes(40), sleep.EndsAt);
    }

    [Fact]
    public void ElapsingClearsEndsAt_SoTheSameTimerCanBeSetAgain()
    {
        using var sleep = new SleepTimer(_time);
        var elapsed = 0;
        sleep.Elapsed += () => elapsed++;

        sleep.Set(TimeSpan.FromMinutes(15));
        _time.Advance(TimeSpan.FromMinutes(15));

        Assert.False(sleep.IsSet);
        Assert.Null(sleep.EndsAt);

        sleep.Set(TimeSpan.FromMinutes(15));
        _time.Advance(TimeSpan.FromMinutes(15));

        Assert.Equal(2, elapsed);
    }

    [Fact]
    public void RefusesATimeThatIsAlreadyUp()
    {
        using var sleep = new SleepTimer(_time);

        Assert.Throws<ArgumentOutOfRangeException>(() => sleep.Set(TimeSpan.Zero));
    }
}
