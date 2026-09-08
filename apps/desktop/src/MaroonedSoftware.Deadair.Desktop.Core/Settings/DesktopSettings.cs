using System.Text.Json.Serialization;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>What this install wants to look like. Chosen per install, remembered locally.</summary>
/// <remarks>
/// <para>
/// <see cref="System"/> is the default and means "whatever macOS is set to", which is the answer for
/// almost everybody: this app is a listener before it is a desk, and somebody who has told the
/// operating system they want light has already said so once.
/// </para>
/// <para>
/// Written as a NAME rather than a number. Without the converter this file is a settings file whose
/// appearance reads `2`, and — the way this was actually found — a hand-written or hand-edited file
/// fails to parse at all, is swallowed by the store's deliberate tolerance of a bad file, and the app
/// starts as though nobody had ever configured it.
/// </para>
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter<Appearance>))]
public enum Appearance
{
    /// <summary>Follow the operating system, and follow it again when it changes.</summary>
    System,

    Light,

    Dark,
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

    /// <summary>
    /// Light, dark, or whatever the system says.
    /// </summary>
    /// <remarks>
    /// The key is `appearance` and not `theme`: the old key named one of three consoles, and a file
    /// still carrying it reads as <see cref="Appearance.System"/>, which is the right answer for
    /// somebody who never went looking for this setting in the first place.
    /// </remarks>
    [JsonPropertyName("appearance")]
    public Appearance Appearance { get; init; } = Appearance.System;

    /// <summary>0.0 to 1.0.</summary>
    [JsonPropertyName("volume")]
    public double Volume { get; init; } = 0.8;
}
