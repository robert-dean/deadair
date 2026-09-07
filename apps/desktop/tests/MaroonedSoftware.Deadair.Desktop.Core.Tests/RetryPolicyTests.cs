using System.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Net;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class RetryPolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 7, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError, true)]
    [InlineData(HttpStatusCode.BadGateway, true)]
    [InlineData(HttpStatusCode.RequestTimeout, true)]
    [InlineData(HttpStatusCode.TooManyRequests, true)]
    [InlineData(HttpStatusCode.BadRequest, false)]
    [InlineData(HttpStatusCode.Unauthorized, false)]
    [InlineData(HttpStatusCode.Forbidden, false)]
    [InlineData(HttpStatusCode.NotFound, false)]
    [InlineData(HttpStatusCode.Conflict, false)]
    public void RetriesWhatCanChangeAndNothingElse(HttpStatusCode status, bool expected)
    {
        // 408 and 429 are the server saying "later"; every other 4xx will fail identically the second
        // time, and retrying a 409 from `POST /playout/start` just asks a station that has nothing to
        // resume the same question twice.
        Assert.Equal(expected, RetryPolicy.ShouldRetry(status));
    }

    [Fact]
    public void ReadsRetryAfterAsFractionalSeconds()
    {
        // The measurement this test exists for. The station's rate limiter reports its own
        // `msBeforeNext` divided by a thousand, so a sub-second wait arrives as `0.35` — and a client
        // parsing that as an integer floors it to zero and hot-loops against a server that is already
        // asking it to slow down.
        Assert.Equal(TimeSpan.FromMilliseconds(350), RetryPolicy.RetryAfter("0.35", Now));
        Assert.Equal(TimeSpan.FromSeconds(2), RetryPolicy.RetryAfter("2", Now));
    }

    [Fact]
    public void AlsoReadsAnHttpDate()
    {
        var when = Now.AddSeconds(30).ToString("R", System.Globalization.CultureInfo.InvariantCulture);

        Assert.Equal(TimeSpan.FromSeconds(30), RetryPolicy.RetryAfter(when, Now));
    }

    [Fact]
    public void TreatsAPastDeadlineAsNoWaitRatherThanANegativeOne()
    {
        var when = Now.AddSeconds(-30).ToString("R", System.Globalization.CultureInfo.InvariantCulture);

        Assert.Equal(TimeSpan.Zero, RetryPolicy.RetryAfter(when, Now));
        Assert.Equal(TimeSpan.Zero, RetryPolicy.RetryAfter("-5", Now));
    }

    [Fact]
    public void AnswersNothingForAHeaderItCannotRead()
    {
        Assert.Null(RetryPolicy.RetryAfter(null, Now));
        Assert.Null(RetryPolicy.RetryAfter("soon", Now));
    }

    [Fact]
    public void BacksOffExponentiallyAndStaysUnderTheCap()
    {
        var random = new Random(1);

        for (var attempt = 1; attempt <= 12; attempt++)
        {
            var wait = RetryPolicy.Backoff(attempt, random);

            Assert.True(wait >= TimeSpan.Zero);
            Assert.True(wait <= TimeSpan.FromSeconds(30), $"attempt {attempt} waited {wait}");
        }
    }

    [Fact]
    public void JittersSoThatPollersWhichFailedTogetherDoNotComeBackInStep()
    {
        var random = new Random(7);

        var waits = Enumerable.Range(0, 20).Select(_ => RetryPolicy.Backoff(4, random)).Distinct().Count();

        Assert.True(waits > 1);
    }
}
