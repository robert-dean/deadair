using System.Text.Json.Serialization;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>Which console this console is. Chosen per install, remembered locally.</summary>
public enum ThemeId
{
    /// <summary>The studio at night. Phosphor green on carbon. What an install with no preference gets.</summary>
    Carbon,

    /// <summary>Daylight and paper. Rules instead of fills.</summary>
    White,

    /// <summary>Neon yellow on teal-black. The loudest of the three.</summary>
    Neon,
}

/// <summary>
/// What this copy of the app remembers between launches, none of which is a secret.
/// </summary>
/// <remarks>
/// Kept in a DIFFERENT file from anything to do with a session. Clearing a sign-in must not take the
/// station address with it: somebody who signs out is still a listener, and making them retype the
/// address to keep listening would be punishing them for signing out.
/// </remarks>
public sealed record DesktopSettings
{
    /// <summary>The station's origin, as typed. Absent until somebody has entered one.</summary>
    [JsonPropertyName("station")]
    public string? Station { get; init; }

    /// <summary>The station's own name at the last successful probe, so the setup screen can name it.</summary>
    [JsonPropertyName("stationName")]
    public string? StationName { get; init; }

    /// <summary>
    /// Which mount to prefer.
    /// </summary>
    /// <remarks>
    /// A preference rather than an instruction: the station decides what it publishes, and a format
    /// switched off since this was chosen falls back to MP3, which has no switch.
    /// </remarks>
    [JsonPropertyName("format")]
    public NowPlayingMountFormat Format { get; init; } = NowPlayingMountFormat.Mp3;

    [JsonPropertyName("theme")]
    public ThemeId Theme { get; init; } = ThemeId.Carbon;

    /// <summary>0.0 to 1.0.</summary>
    [JsonPropertyName("volume")]
    public double Volume { get; init; } = 0.8;
}
