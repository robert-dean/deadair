using System.Text.Json.Serialization;

namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Manifest;

/// <summary>Which type in which assembly the host builds.</summary>
/// <param name="Assembly">A file name, found beside the manifest.</param>
/// <param name="Type">
/// A namespace-qualified type name implementing <see cref="IDeadairPlugin"/>. It is a string and the
/// class is a class, so the two can be moved apart by a rename; the load failure names both.
/// </param>
public sealed record PluginEntryPoint(
    [property: JsonPropertyName("assembly")] string Assembly,
    [property: JsonPropertyName("type")] string Type);

/// <summary>
/// What a plugin says about itself, read before any of its code runs.
/// </summary>
/// <remarks>
/// <para>
/// A <c>plugin.json</c> beside the assembly, which is what makes a directory a plugin. A file rather
/// than an assembly attribute for three reasons: the compatibility check happens BEFORE the assembly
/// is opened, so it cannot be defeated by an assembly that will not load; a disabled plugin's name
/// and fields can be drawn with nothing executed; and reading an attribute without running the
/// assembly would mean a metadata-only load context, which is a dependency for no gain.
/// </para>
/// <para>
/// There is no <c>kind</c>. <see cref="Capabilities"/> is the only thing the host dispatches on,
/// which is the station's arrangement and its reasoning: a plugin that claims a kind and forgets a
/// method fails in the middle of a request, while a mismatched capability is caught once, at load.
/// </para>
/// </remarks>
public sealed record PluginManifest
{
    /// <summary>Reverse-DNS, like <c>deadair.bluos</c>. What the operator's settings are keyed by.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>What it is called on the settings page.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>The plugin's own version, shown beside the name. Never interpreted.</summary>
    [JsonPropertyName("version")]
    public required string Version { get; init; }

    /// <summary>
    /// The contract this plugin needs, as a RANGE: <c>^1.0.0</c>, <c>1.2.0</c>, <c>&gt;=1.1.0</c>.
    /// Checked against <see cref="PluginApi.Version"/> before the assembly is opened.
    /// </summary>
    [JsonPropertyName("apiVersion")]
    public required string ApiVersion { get; init; }

    /// <summary>A sentence about what it does.</summary>
    [JsonPropertyName("description")]
    public string? Description { get; init; }

    /// <summary>
    /// What it can do; see <see cref="PluginCapabilities"/>. An unrecognised entry is kept rather
    /// than refused, so a plugin built for a later app still loads for what this one understands.
    /// </summary>
    [JsonPropertyName("capabilities")]
    public IReadOnlyList<string> Capabilities { get; init; } = [];

    [JsonPropertyName("entry")]
    public required PluginEntryPoint Entry { get; init; }

    [JsonPropertyName("configFields")]
    public IReadOnlyList<PluginConfigField> ConfigFields { get; init; } = [];
}
