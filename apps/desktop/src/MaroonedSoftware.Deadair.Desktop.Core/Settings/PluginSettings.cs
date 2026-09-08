using System.Text.Json.Serialization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Settings;

/// <summary>
/// What this install has decided about one plugin.
/// </summary>
/// <remarks>
/// Kept beside the app's own preferences rather than in a file per plugin. A second store would need
/// its own answer to a truncated write and its own place in a backup, all to avoid a race the one
/// store should not have in the first place — which is why <see cref="ISettingsStore.UpdateAsync"/>
/// exists instead.
/// </remarks>
public sealed record PluginSettings
{
    /// <summary>
    /// Whether it runs.
    /// </summary>
    /// <remarks>
    /// A disabled plugin is still discovered and still drawn, with its name, its version and its
    /// settings: an operator turning something off should be able to see what they turned off. Its
    /// code is never loaded.
    /// </remarks>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; init; }

    /// <summary>
    /// Its declared fields, as strings.
    /// </summary>
    /// <remarks>
    /// Strings whatever the field's type, because every layer of this station's configuration is
    /// text: an on/off setting is the word <c>true</c> and a number is its digits. A JSON boolean
    /// here would be a shape nothing else in the tree stores.
    /// </remarks>
    [JsonPropertyName("config")]
    public IReadOnlyDictionary<string, string> Config { get; init; } = new Dictionary<string, string>(StringComparer.Ordinal);
}
