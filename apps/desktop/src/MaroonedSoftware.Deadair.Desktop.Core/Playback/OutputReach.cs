using MaroonedSoftware.Deadair.Desktop.Core.Station;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// Whether an output could reach the station at all.
/// </summary>
/// <remarks>
/// One question, asked before a device is handed a mount it cannot fetch. A speaker on the network
/// resolves an address for itself, so the station's own address has to be one that means the same
/// thing from somewhere else in the house — and <c>localhost</c> is the address that most obviously
/// does not. Asking first turns a device that plays silence into a sentence.
/// </remarks>
public static class OutputReach
{
    /// <summary>False only for a device being sent to a station that is on this machine alone.</summary>
    public static bool CanReach(StationUrl station, Output output)
    {
        ArgumentNullException.ThrowIfNull(output);

        if (output.IsLocal)
        {
            return true;
        }

        var host = station.Origin.Host;

        return !string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(host, "127.0.0.1", StringComparison.Ordinal)
            && !string.Equals(host, "::1", StringComparison.Ordinal)
            && !string.Equals(host, "[::1]", StringComparison.Ordinal);
    }

    /// <summary>What to tell somebody who chose a device the station is invisible to.</summary>
    public static string Explain(StationUrl station, Output output)
    {
        ArgumentNullException.ThrowIfNull(output);

        return $"{output.Name} cannot reach a station at {station.Origin.Host}, which only means anything on this machine.";
    }
}
