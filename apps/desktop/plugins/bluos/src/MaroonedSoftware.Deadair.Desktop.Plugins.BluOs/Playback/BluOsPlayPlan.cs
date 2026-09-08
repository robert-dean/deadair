namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;

/// <summary>
/// Whether starting means stopping first.
/// </summary>
/// <remarks>
/// <para>
/// Measured on the M10 and not in any specification: <c>/Play</c> issued against the URL the player
/// is ALREADY on does nothing at all, in either direction. It does not restart the stream and it
/// does not refresh the display, and it answers as though it worked.
/// </para>
/// <para>
/// So a restart against our own mount has to be a stop and then a play. What must not happen is an
/// unconditional stop before every play: the host re-calls <c>PlayAsync</c> after a poll failure
/// too, and a player that is streaming perfectly well while a status request timed out should not be
/// interrupted to prove it.
/// </para>
/// </remarks>
public static class BluOsPlayPlan
{
    /// <summary>True when the player is already on our mount and has not stopped.</summary>
    public static bool StopFirst(string? state, StreamMatch match)
    {
        if (match != StreamMatch.Ours)
        {
            // On another source, /Play switches it over on its own; with nothing playing there is
            // nothing to stop.
            return false;
        }

        var word = state?.Trim().ToLowerInvariant();

        return word is not (null or "" or "stop");
    }
}
