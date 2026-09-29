using System.Globalization;
using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Forms;

/// <summary>How a form's values travel to whatever stores them.</summary>
public enum FormEncoding
{
    /// <summary>
    /// Every value as text: the station's own settings, where every layer of its configuration holds
    /// a string and a switch is the word <c>true</c>.
    /// </summary>
    Strings,

    /// <summary>
    /// Every value in its JSON type: a plugin's configuration, which is stored exactly as sent and read
    /// by the plugin as a boolean or a number.
    /// </summary>
    Typed,
}

/// <summary>
/// The encodings a form field's value is stored in, read and written in one place.
/// </summary>
/// <remarks>
/// Each of these is a rule the station and the web console already agree on, spelled out rather than
/// guessed: a multiselect is a JSON array in a string, a tags field is a comma-separated line, a switch
/// is read in the station's whole vocabulary. Getting one wrong is a setting that looks saved and is
/// read as something else.
/// </remarks>
public static class FormValues
{
    public const double BytesPerGigabyte = 1_000_000_000d;

    /// <summary>Reads a stored value as text, whatever JSON shape it arrived in.</summary>
    /// <remarks>
    /// `ToString` on a string element would wrap it in quotes, which is how a setting acquires a pair
    /// of them.
    /// </remarks>
    public static string? Read(JsonElement? value) => value switch
    {
        null => null,
        { ValueKind: JsonValueKind.String } element => element.GetString(),
        { ValueKind: JsonValueKind.True } => "true",
        { ValueKind: JsonValueKind.False } => "false",
        { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => null,
        { } element => element.GetRawText(),
    };

    /// <summary>A declared default as text.</summary>
    /// <remarks>
    /// The default is a small union rather than a string, so it is matched rather than stringified:
    /// `ToString` on the record gives <c>OfBoolean { Value = True }</c>, which parses as nothing.
    /// </remarks>
    public static string? Read(ConfigFieldDescriptorDefault? fallback) => fallback switch
    {
        ConfigFieldDescriptorDefault.OfString text => text.Value,
        ConfigFieldDescriptorDefault.OfBoolean boolean => boolean.Value ? "true" : "false",
        ConfigFieldDescriptorDefault.OfNumber number => number.Value.ToString(CultureInfo.InvariantCulture),
        _ => null,
    };

    /// <summary>
    /// The station's own vocabulary for a switch, with anything unreadable taking the default.
    /// </summary>
    /// <remarks>
    /// `config.get(key, false)` answers the STRING `'false'`, which is truthy: a bug that was live in
    /// six places at once on the station. A value nobody can read is a value nobody set, so it falls
    /// to the declared default rather than to off.
    /// </remarks>
    public static bool IsOn(string? value, ConfigFieldDescriptorDefault? fallback)
    {
        var parsed = Parse(value);
        return parsed ?? Parse(Read(fallback)) ?? false;

        static bool? Parse(string? text) => text?.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" => true,
            "false" or "0" or "no" or "off" => false,
            _ => null,
        };
    }

    /// <summary>A multiselect's chosen values, out of the JSON array it is stored as.</summary>
    /// <remarks>Tolerant: a hand-edited value costs the field rather than the page.</remarks>
    public static IReadOnlyList<string> Chosen(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            return document.RootElement.ValueKind == JsonValueKind.Array
                ? [.. document.RootElement.EnumerateArray()
                    .Where(entry => entry.ValueKind == JsonValueKind.String)
                    .Select(entry => entry.GetString()!)]
                : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>A multiselect's chosen values as the JSON array they are stored as.</summary>
    public static string Choose(IEnumerable<string> chosen) => JsonSerializer.Serialize(chosen.ToList());

    /// <summary>A tags field's entries, out of the one comma-separated line it is stored as.</summary>
    /// <remarks>
    /// NOT the JSON a multiselect uses: this control is drawn over a setting that was already a
    /// comma-separated line and is read as one on the station, so changing the encoding would be
    /// changing the setting rather than the control.
    /// </remarks>
    public static IReadOnlyList<string> Tags(string? value) =>
        value is null
            ? []
            : [.. value.Split(',').Select(entry => entry.Trim()).Where(entry => entry.Length > 0)];

    /// <summary>The entries of a tags field as the line they are stored as.</summary>
    public static string Tag(IEnumerable<string> entries) =>
        string.Join(',', entries.Select(entry => entry.Trim()).Where(entry => entry.Length > 0));

    /// <summary>A byte count as the gigabytes it is shown in, empty for "no limit".</summary>
    /// <remarks>"No limit" is stored as 0 rather than as an absent value, so 0 draws empty.</remarks>
    public static string Gigabytes(string? bytes) =>
        double.TryParse(bytes, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value > 0
            ? Math.Round(value / BytesPerGigabyte, 2).ToString(CultureInfo.InvariantCulture)
            : string.Empty;

    /// <summary>Gigabytes as typed, as the byte count stored. Anything unreadable or not positive is 0.</summary>
    public static string Bytes(string? gigabytes) =>
        double.TryParse(gigabytes, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value > 0
            ? Math.Round(value * BytesPerGigabyte).ToString(CultureInfo.InvariantCulture)
            : "0";

    /// <summary>Whether the text is a number the station would take.</summary>
    public static bool IsNumber(string text) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out _);

    /// <summary>A value as the JSON it is sent as, in the encoding the form uses.</summary>
    public static JsonElement Encode(string text, ConfigFieldType type, FormEncoding encoding)
    {
        ArgumentNullException.ThrowIfNull(text);

        if (encoding == FormEncoding.Typed)
        {
            if (type == ConfigFieldType.Boolean)
            {
                return JsonSerializer.SerializeToElement(IsOn(text, null));
            }

            if (type == ConfigFieldType.Number
                && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
            {
                return JsonSerializer.SerializeToElement(number);
            }
        }

        return JsonSerializer.SerializeToElement(text);
    }

    /// <summary>The JSON null that clears a stored value.</summary>
    /// <remarks>
    /// Present and explicitly empty, rather than an empty string (which is what a half-typed field
    /// looks like) or absent (which means "keep what is stored").
    /// </remarks>
    public static JsonElement Clear { get; } = JsonSerializer.SerializeToElement<object?>(null);
}
