using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class BackoffTests
{
    [Fact]
    public void DoublesUpToTheCeilingAndStaysThere()
    {
        var backoff = new Backoff();

        var waits = new List<TimeSpan>();
        for (var attempt = 0; attempt < 8; attempt++)
        {
            waits.Add(backoff.Next());
        }

        Assert.Equal(TimeSpan.FromSeconds(1), waits[0]);
        Assert.Equal(TimeSpan.FromSeconds(2), waits[1]);
        Assert.Equal(TimeSpan.FromSeconds(4), waits[2]);

        // The ceiling is what makes an overnight outage survivable without hammering somebody's
        // server: a client still retrying at thirty-second intervals in the morning finds the station.
        Assert.Equal(TimeSpan.FromSeconds(30), waits[^1]);
    }

    [Fact]
    public void StartsOverOnceTheStreamPlaysAgain()
    {
        var backoff = new Backoff();
        backoff.Next();
        backoff.Next();

        backoff.Reset();

        Assert.Equal(TimeSpan.FromSeconds(1), backoff.Next());
        Assert.Equal(1, backoff.Attempts);
    }

    [Fact]
    public void IsSpentOnElapsedTimeRatherThanOnACountOfAttempts()
    {
        var backoff = new Backoff();

        // Five attempts is nothing: they span fifteen seconds between them.
        for (var attempt = 0; attempt < 5; attempt++)
        {
            backoff.Next();
        }

        Assert.False(backoff.Exhausted);

        while (!backoff.Exhausted)
        {
            backoff.Next();
        }

        Assert.True(backoff.Attempts > 10);
    }
}
