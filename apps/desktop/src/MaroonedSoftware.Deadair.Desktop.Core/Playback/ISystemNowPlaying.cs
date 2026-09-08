namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>What the operating system asked the app to do.</summary>
public enum RemoteCommand
{
    Play = 0,

    /// <summary>Stop, and drop the connection. There is no pause on a live mount.</summary>
    Stop = 1,

    /// <summary>
    /// The OPERATOR's skip.
    /// </summary>
    /// <remarks>
    /// Not a track change: a live stream has no next track. It is offered only while the signed-in
    /// account holds the operator role, which is the same rule the Android listener applies to a head
    /// unit's next button — and the same reason. A skip somebody is not allowed to make would be
    /// refused by the station, so drawing the button would be promising something that cannot happen.
    /// </remarks>
    Next = 2,
}

/// <summary>What to put in the system's own Now Playing display.</summary>
/// <param name="Title">The record, or what the station is saying.</param>
/// <param name="Artist">Comma-joined, as a display line.</param>
/// <param name="Album">Absent for a segment.</param>
/// <param name="Artwork">Cover bytes, or null.</param>
/// <param name="Duration">Null when the station's decoder could not say, which draws no scrubber.</param>
/// <param name="Position">How far in, when there is a duration to measure against.</param>
/// <param name="Playing">Whether the app is listening right now.</param>
public readonly record struct NowPlayingCard(
    string? Title,
    string? Artist,
    string? Album,
    byte[]? Artwork,
    TimeSpan? Duration,
    TimeSpan Position,
    bool Playing);

/// <summary>
/// The platform's own now-playing display and media keys.
/// </summary>
/// <remarks>
/// The desktop's version of what a <c>MediaSession</c> buys on Android: the record shows up in the
/// system widget, and the keyboard's play key starts the station without the window being in front.
/// A platform without one implements this as nothing at all.
/// </remarks>
public interface ISystemNowPlaying : IDisposable
{
    /// <summary>Raised on an arbitrary thread when a key is pressed or a widget button is used.</summary>
    event Action<RemoteCommand>? Commanded;

    void Show(NowPlayingCard card);

    void Clear();

    /// <summary>Offers or withdraws the next button. Off for anybody who is only listening.</summary>
    void SetCanSkip(bool canSkip);
}

/// <summary>For a platform that has no such display yet, and for tests.</summary>
/// <remarks>
/// Nothing ever raises <see cref="Commanded"/> here, which is the whole point: a platform with no
/// media keys has none to report, and the app draws its own buttons regardless.
/// </remarks>
public sealed class NullSystemNowPlaying : ISystemNowPlaying
{
#pragma warning disable CS0067 // Never raised: there is no system display to raise it.
    public event Action<RemoteCommand>? Commanded;
#pragma warning restore CS0067

    public void Show(NowPlayingCard card)
    {
    }

    public void Clear()
    {
    }

    public void SetCanSkip(bool canSkip)
    {
    }

    public void Dispose()
    {
    }
}
