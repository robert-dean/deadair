namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// One reading of what the player is doing, and why if there is a why.
/// </summary>
/// <param name="Phase">What it is doing.</param>
/// <param name="Detail">
/// The platform's own words, when it supplied any. Shown to nobody by itself: it goes in a log and
/// beside a message the app wrote. A player's error text is not written for a listener.
/// </param>
public readonly record struct PlayerStatus(PlayerPhase Phase, string? Detail = null)
{
    public static PlayerStatus Stopped { get; } = new(PlayerPhase.Stopped);
}
