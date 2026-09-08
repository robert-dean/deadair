namespace MaroonedSoftware.Deadair.Desktop.Core.Net;

/// <summary>
/// The latest answer to a question the app keeps asking, and how much to trust it.
/// </summary>
/// <remarks>
/// <para>
/// The station has no realtime channel of any kind: no websocket, no server-sent events. Every live
/// reading in every client is a poll, so what a screen actually holds is a value, when it arrived,
/// and whether the last attempt to refresh it worked.
/// </para>
/// <para>
/// <b>A failed refresh keeps the last good value and marks it stale</b>, rather than replacing it
/// with nothing. Blanking a running order because one poll timed out throws away something true and
/// still useful, and it is the station's own rule in the other direction: a failed reading of the
/// listener count is "could not say", never zero.
/// </para>
/// </remarks>
/// <typeparam name="T">What is being read.</typeparam>
public readonly record struct Reading<T>
{
    private Reading(T? value, bool hasValue, bool stale, Exception? failure, DateTimeOffset? readAt)
    {
        Value = value;
        HasValue = hasValue;
        Stale = stale;
        Failure = failure;
        ReadAt = readAt;
    }

    public T? Value { get; }

    /// <summary>False only before the first successful read.</summary>
    public bool HasValue { get; }

    /// <summary>True when the most recent attempt failed. <see cref="Value"/> is the last good one.</summary>
    public bool Stale { get; }

    /// <summary>Why the last attempt failed, when one did.</summary>
    public Exception? Failure { get; }

    /// <summary>When <see cref="Value"/> was read. Used to project a playhead between readings.</summary>
    public DateTimeOffset? ReadAt { get; }

    public static Reading<T> Empty { get; } = new(default, hasValue: false, stale: false, failure: null, readAt: null);

    public static Reading<T> Good(T value, DateTimeOffset readAt) =>
        new(value, hasValue: true, stale: false, failure: null, readAt);

    /// <summary>A failed attempt, carrying whatever was last known.</summary>
    public Reading<T> Failed(Exception failure) =>
        new(Value, HasValue, stale: true, failure, ReadAt);
}
