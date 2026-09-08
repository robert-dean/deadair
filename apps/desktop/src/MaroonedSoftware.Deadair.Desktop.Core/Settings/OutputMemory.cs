using System.Text.Json.Serialization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>
/// The device somebody last chose to play on, so the app comes back to it.
/// </summary>
/// <remarks>
/// <para>
/// Absent means this machine, which is the default and needs nothing written down.
/// </para>
/// <para>
/// It carries the NAME and the ADDRESS as well as the ids, and both are for the case where the
/// device is not there at launch. The name is so the app can say which device it could not find
/// rather than "a device"; the address is so a device that never answers a discovery — one an
/// operator typed in by hand — is still reachable next time.
/// </para>
/// <para>
/// A device that is missing is reported and KEPT rather than forgotten. A speaker switched off
/// tonight is on again tomorrow, and quietly erasing the choice would make the app's memory depend
/// on whether somebody happened to open it during the evening.
/// </para>
/// </remarks>
public sealed record OutputMemory
{
    /// <summary>Which plugin owns it.</summary>
    [JsonPropertyName("pluginId")]
    public required string PluginId { get; init; }

    /// <summary>Its stable id, as that plugin reports it.</summary>
    [JsonPropertyName("deviceId")]
    public required string DeviceId { get; init; }

    /// <summary>What it was called when it was chosen. For a sentence, never for matching.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>Where it was, in the plugin's own shape. Opaque here.</summary>
    [JsonPropertyName("address")]
    public required string Address { get; init; }
}
