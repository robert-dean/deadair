using MaroonedSoftware.Deadair.Desktop.Core.Net;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The lease, the backoff, and what a screen still holds after a failed refresh.
/// </summary>
public class PollerTests
{
    [Fact]
    public async Task DoesNotAskAnythingUntilSomebodyIsListening()
    {
        var asked = 0;
        await using var poller = new Poller<int>(_ => Task.FromResult(Interlocked.Increment(ref asked)), TimeSpan.FromSeconds(2));

        await Task.Delay(50, TestContext.Current.CancellationToken);

        // The whole point of the lease: a repository that exists is not a repository that polls.
        Assert.Equal(0, Volatile.Read(ref asked));
    }

    [Fact]
    public async Task AsksOnceALeaseIsTaken()
    {
        await using var poller = new Poller<int>(_ => Task.FromResult(1), TimeSpan.FromSeconds(2));

        using var lease = poller.Subscribe();

        // Waiting on the READING rather than on the read: the callback returning is not the same
        // moment as its value being published, and a test that waits for the former is a test that
        // fails intermittently.
        await WaitUntil(() => poller.Current.HasValue);

        Assert.Equal(1, poller.Current.Value);
        Assert.False(poller.Current.Stale);
    }

    [Fact]
    public async Task KeepsTheLastGoodValueWhenARefreshFails()
    {
        var attempt = 0;
        var second = new TaskCompletionSource();

        await using var poller = new Poller<string>(
            _ =>
            {
                var which = Interlocked.Increment(ref attempt);
                if (which == 1)
                {
                    return Task.FromResult("the running order");
                }

                second.TrySetResult();
                throw new HttpRequestException("the station went away");
            },
            TimeSpan.FromMilliseconds(20));

        using var lease = poller.Subscribe();
        await second.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await Task.Delay(50, TestContext.Current.CancellationToken);

        // Blanking the screen because one poll timed out throws away something true and still useful.
        // It is the station's own rule read the other way: a failed reading is "could not say", never
        // an empty answer.
        Assert.True(poller.Current.HasValue);
        Assert.Equal("the running order", poller.Current.Value);
        Assert.True(poller.Current.Stale);
        Assert.IsType<HttpRequestException>(poller.Current.Failure);
    }

    [Fact]
    public async Task StopsAskingOnceTheLastLeaseIsGoneAndItsGracePeriodHasPassed()
    {
        var asked = 0;
        var time = new FakeTimeProvider();

        await using var poller = new Poller<int>(
            _ => Task.FromResult(Interlocked.Increment(ref asked)),
            TimeSpan.FromSeconds(2),
            time: time);

        var lease = poller.Subscribe();
        await WaitUntil(() => Volatile.Read(ref asked) >= 1);

        lease.Dispose();

        // Six seconds is past the five-second grace, which exists so that moving between two screens
        // that read the same thing does not tear the loop down and build it again.
        time.Advance(TimeSpan.FromSeconds(6));
        await Task.Delay(50, TestContext.Current.CancellationToken);

        var settled = Volatile.Read(ref asked);
        time.Advance(TimeSpan.FromSeconds(30));
        await Task.Delay(50, TestContext.Current.CancellationToken);

        Assert.Equal(settled, Volatile.Read(ref asked));
    }

    private static async Task WaitUntil(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(10, TestContext.Current.CancellationToken);
        }

        Assert.Fail("condition was never met");
    }
}
