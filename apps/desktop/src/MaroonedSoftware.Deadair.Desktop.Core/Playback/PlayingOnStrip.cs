namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// What the strip across the top of the window says while the station is playing somewhere other than
/// this Mac.
/// </summary>
/// <remarks>
/// The speaker's NAME, in words, rather than the bar's lit icon alone: somebody across the room from
/// the screen should be able to see where the sound is going without reaching for the pointer to hover
/// over anything. A device that missed the last scan is said to be missing and nothing more; the strip
/// never moves playback, for the reason nothing in this app does on its own.
/// </remarks>
public static class PlayingOnStrip
{
    /// <summary>The words, or <c>null</c> when the station is coming out of this machine and there is no strip.</summary>
    public static string? Caption(bool onDevice, string name, bool missing)
    {
        if (!onDevice || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        return missing ? $"Playing on {name}, which is not on the network" : $"Playing on {name}";
    }
}
