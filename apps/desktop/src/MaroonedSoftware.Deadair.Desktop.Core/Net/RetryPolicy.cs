using System.Globalization;
using System.Net;

namespace MaroonedSoftware.Deadair.Desktop.Core.Net;

/// <summary>
/// Whether to try a request again, and how long to wait first.
/// </summary>
/// <remarks>
/// <para>
/// A port of the web console's policy, because a second client that disagreed with the first about
/// what a 429 means would be a second set of behaviour for the operator to learn.
/// </para>
/// <para>
/// <b>A 4xx is never retried, with two exceptions.</b> 408 and 429 are the server saying "later"
/// rather than "no", and everything else in that range is a request that will fail identically the
/// second time. A 5xx is retried because it may not.
/// </para>
/// </remarks>
public static class RetryPolicy
{
    public const int MaxAttempts = 3;

    /// <summary>The longest a <c>Retry-After</c> is honoured before the request is simply failed.</summary>
    public static readonly TimeSpan RetryAfterCeiling = TimeSpan.FromSeconds(10);

    private static readonly TimeSpan BackoffCap = TimeSpan.FromSeconds(30);

    public static bool ShouldRetry(HttpStatusCode status)
    {
        var code = (int)status;

        if (code is >= 400 and < 500)
        {
            return status is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests;
        }

        return code >= 500;
    }

    /// <summary>
    /// Reads a <c>Retry-After</c>, in the shape this station actually sends it.
    /// </summary>
    /// <remarks>
    /// <b>Fractional seconds.</b> The rate limiter reports its own <c>msBeforeNext</c> divided by a
    /// thousand, so a sub-second wait arrives as <c>0.35</c> — and a client that parsed it as an
    /// integer would floor it to zero and hot-loop against a server already asking it to slow down.
    /// An HTTP-date is accepted too, because the header allows one.
    /// </remarks>
    public static TimeSpan? RetryAfter(string? header, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(header))
        {
            return null;
        }

        if (double.TryParse(header, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds))
        {
            return seconds <= 0 ? TimeSpan.Zero : TimeSpan.FromSeconds(seconds);
        }

        if (DateTimeOffset.TryParse(header, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var when))
        {
            var wait = when - now;
            return wait <= TimeSpan.Zero ? TimeSpan.Zero : wait;
        }

        return null;
    }

    /// <summary>
    /// How long to wait before attempt <paramref name="attempt"/>, counting from one.
    /// </summary>
    /// <remarks>
    /// Exponential with full jitter. The jitter is what stops several pollers that all failed at the
    /// same moment — which is what a station restart looks like from here — coming back in step and
    /// failing together again.
    /// </remarks>
    public static TimeSpan Backoff(int attempt, Random random)
    {
        ArgumentNullException.ThrowIfNull(random);
        ArgumentOutOfRangeException.ThrowIfLessThan(attempt, 1);

        var exponential = TimeSpan.FromSeconds(Math.Pow(2, attempt - 1));
        var capped = exponential > BackoffCap ? BackoffCap : exponential;

        return capped * random.NextDouble();
    }
}
