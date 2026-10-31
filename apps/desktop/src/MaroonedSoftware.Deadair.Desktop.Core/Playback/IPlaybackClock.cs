namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// A player whose media clock can be read.
/// </summary>
/// <remarks>
/// Optional, and separate from <c>IStationPlayer</c> so that a player with no clock has nothing to
/// implement. It is what lets <see cref="PlaybackConductor"/> tell a stale phase from a real stall,
/// because the clock moves only while audio is coming out. Here rather than in the plugin contract
/// because only this Mac's player has one so far; a plugin wanting to offer one moves it there.
/// </remarks>
public interface IPlaybackClock
{
    /// <summary>
    /// How far into the current connection playback has got, or null when the player cannot say.
    /// Read from the thread that drives the player.
    /// </summary>
    TimeSpan? Position { get; }
}
