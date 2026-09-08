using System.Text.Json;
using System.Text.Json.Serialization;

namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Manifest;

/// <summary>
/// What kind of thing a field holds, which is what the settings page draws it as.
/// </summary>
/// <remarks>
/// <para>
/// The names on the wire are the station's own vocabulary, so a plugin author who has written one
/// for the server writes the same words here.
/// </para>
/// <para>
/// <b>There is no <c>secret</c>, and that is a deliberate gap rather than an oversight.</b> A secret
/// must not go in the settings file, which means a text-keyed credential store and a Keychain that
/// can hold something other than a session — real work, for nothing that exists yet. A plugin
/// declaring one is refused with a message naming the type, which is honest; drawing it as a text
/// box would put a password in a JSON file in the operator's home directory.
/// </para>
/// <para>
/// <c>multiselect</c> and <c>list</c> are missing for the smaller version of the same reason: the
/// station's console draws them and nothing here does yet.
/// </para>
/// </remarks>
[JsonConverter(typeof(PluginConfigFieldTypeConverter))]
public enum PluginConfigFieldType
{
    /// <summary>
    /// One line. Called <c>string</c> on the wire, which is the station's own word for it; the
    /// member is <c>Line</c> because an identifier named after a type reads as one everywhere it is
    /// used, and the pair it belongs with is <see cref="Text"/>.
    /// </summary>
    Line,

    /// <summary>Several lines.</summary>
    Text,

    /// <summary>An address. Drawn as one line; the plugin decides what a valid one is.</summary>
    Url,

    /// <summary>Digits. Still a string on the way in and out.</summary>
    Number,

    /// <summary>On or off, travelling as the word <c>true</c> or <c>false</c>.</summary>
    Boolean,

    /// <summary>One of <see cref="PluginConfigField.Options"/>.</summary>
    Select,

    /// <summary>Not a field at all: a sentence drawn between the others.</summary>
    Note,
}

/// <summary>
/// Reads and writes a field type by the station's own word for it.
/// </summary>
/// <remarks>
/// Hand-written rather than <c>JsonStringEnumConverter</c> for one reason, and it is the message.
/// The built-in converter refuses an unknown value with the name of the ENUM and a JSON path, so an
/// operator who wrote <c>secret</c> in a plugin they are debugging is told that something at
/// <c>$.configFields[0].type</c> could not be converted, and never which word this app did not know.
/// The word is the only part they can act on.
/// </remarks>
internal sealed class PluginConfigFieldTypeConverter : JsonConverter<PluginConfigFieldType>
{
    private static readonly (string Wire, PluginConfigFieldType Type)[] Names =
    [
        ("string", PluginConfigFieldType.Line),
        ("text", PluginConfigFieldType.Text),
        ("url", PluginConfigFieldType.Url),
        ("number", PluginConfigFieldType.Number),
        ("boolean", PluginConfigFieldType.Boolean),
        ("select", PluginConfigFieldType.Select),
        ("note", PluginConfigFieldType.Note),
    ];

    public override PluginConfigFieldType Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var text = reader.GetString();

        foreach (var (wire, type) in Names)
        {
            if (string.Equals(wire, text, StringComparison.OrdinalIgnoreCase))
            {
                return type;
            }
        }

        throw new JsonException(
            $"""config field type "{text}" is not one this app can draw: {string.Join(", ", Names.Select(name => name.Wire))}.""");
    }

    public override void Write(Utf8JsonWriter writer, PluginConfigFieldType value, JsonSerializerOptions options)
    {
        ArgumentNullException.ThrowIfNull(writer);

        foreach (var (wire, type) in Names)
        {
            if (type == value)
            {
                writer.WriteStringValue(wire);
                return;
            }
        }

        throw new JsonException($"config field type {value} has no name on the wire");
    }
}

/// <summary>One choice offered by a <see cref="PluginConfigFieldType.Select"/>.</summary>
public sealed record PluginConfigOption
{
    [JsonPropertyName("value")]
    public required string Value { get; init; }

    [JsonPropertyName("label")]
    public required string Label { get; init; }
}

/// <summary>
/// One thing an operator can set, declared so that a plugin nobody has written yet gets a working
/// settings screen the moment the app can read its manifest.
/// </summary>
/// <remarks>
/// There is no per-plugin code on the settings page, on purpose. That is the station console's own
/// arrangement and the property that makes it worth copying: the form is written once and a plugin
/// author writes JSON rather than a screen.
/// </remarks>
public sealed record PluginConfigField
{
    /// <summary>How the plugin reads it back out of <see cref="IPluginHost.Config"/>.</summary>
    [JsonPropertyName("key")]
    public required string Key { get; init; }

    /// <summary>What the operator sees beside the box.</summary>
    [JsonPropertyName("label")]
    public required string Label { get; init; }

    [JsonPropertyName("type")]
    public required PluginConfigFieldType Type { get; init; }

    /// <summary>A sentence under the box. Where the reason for a setting goes.</summary>
    [JsonPropertyName("help")]
    public string? Help { get; init; }

    /// <summary>
    /// What the plugin gets when nobody has set it. A STRING whatever the type, because every layer
    /// of this station's configuration is text and a JSON boolean here would be a shape nothing else
    /// stores.
    /// </summary>
    [JsonPropertyName("default")]
    public string? Default { get; init; }

    /// <summary>
    /// Whether the plugin cannot run without it. A required field with neither a value nor a default
    /// leaves the plugin misconfigured rather than failed, which is a different sentence on the page.
    /// </summary>
    [JsonPropertyName("required")]
    public bool Required { get; init; }

    /// <summary>Ghost text. An example, never a default: it is not what an empty box means.</summary>
    [JsonPropertyName("placeholder")]
    public string? Placeholder { get; init; }

    /// <summary>The choices, for a <see cref="PluginConfigFieldType.Select"/>.</summary>
    [JsonPropertyName("options")]
    public IReadOnlyList<PluginConfigOption> Options { get; init; } = [];
}
