namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// How long to wait before trying the stream again, and when to stop trying.
/// </summary>
/// <remarks>
/// Doubling from one second to thirty, then holding there. The ceiling matters more than the curve:
/// a listener who left the app open overnight through a router reboot should find the station
/// playing, and a client that gave up after five tries would not — but one that retried every second
/// for eight hours is a client hammering somebody's server.
///
/// Not random, and deliberately so. Jitter is for a thundering herd of clients, and a desktop app
/// with one listener on it is not one.
/// </remarks>
public sealed class Backoff
{
    private static readonly TimeSpan First = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan Ceiling = TimeSpan.FromSeconds(30);

    /// <summary>How long to keep trying before treating the station as unreachable.</summary>
    public static readonly TimeSpan GiveUpAfter = TimeSpan.FromMinutes(5);

    private TimeSpan _next = First;
    private TimeSpan _spent = TimeSpan.Zero;

    public int Attempts { get; private set; }

    /// <summary>True once the attempts have spanned <see cref="GiveUpAfter"/>.</summary>
    public bool Exhausted => _spent >= GiveUpAfter;

    /// <summary>The next wait, doubling up to the ceiling.</summary>
    public TimeSpan Next()
    {
        var wait = _next;
        Attempts++;
        _spent += wait;
        _next = _next >= Ceiling ? Ceiling : Min(Ceiling, _next * 2);
        return wait;
    }

    /// <summary>Called when the stream plays again. The next outage starts from one second.</summary>
    public void Reset()
    {
        _next = First;
        _spent = TimeSpan.Zero;
        Attempts = 0;
    }

    private static TimeSpan Min(TimeSpan a, TimeSpan b) => a < b ? a : b;
}
