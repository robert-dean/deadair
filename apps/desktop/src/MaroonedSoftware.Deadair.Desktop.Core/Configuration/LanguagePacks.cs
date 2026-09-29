using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>
/// A console language pack read from a file, with the console's reasons for refusing one.
/// </summary>
/// <remarks>
/// <para>
/// The header checks are the console's <c>checkLanguagePack</c>, in its order and with its words, so a
/// file refused in one is refused in the other for the same stated reason. The format and version are
/// <c>LANGUAGE_PACK_FORMAT</c> and <c>LANGUAGE_PACK_VERSION</c>.
/// </para>
/// <para>
/// What this does NOT do is the console's string-by-string comparison against English (placeholders,
/// markup, keys this version has not got), because this app does not carry the console's English
/// catalog and a copy of it here would be wrong within a release. The pack is sent as read.
/// </para>
/// </remarks>
public static class LanguagePacks
{
    public const string Format = "deadair.console-language";

    public const long Version = 1;

    /// <summary>The pack in a file, or why it cannot be one.</summary>
    public static (ConsoleLanguagePack? Pack, string? Problem) Read(byte[] data, string fileName)
    {
        ArgumentNullException.ThrowIfNull(data);

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(data);
        }
        catch (JsonException)
        {
            return (null, $"{fileName} is not a JSON file, so it cannot be a language pack.");
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || Text(root, "format") != Format)
            {
                return (null, $"{fileName} is not a console language pack.");
            }

            if (!root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number
                || !version.TryGetInt64(out var number) || number > Version)
            {
                return (null, $"{fileName} was made for a newer console. Update the station, then import it again.");
            }

            if (Locale(Text(root, "locale")) is not { } locale)
            {
                return (null, $"{fileName} does not say which language it is in, as a language tag such as de or pt-BR.");
            }

            // English is built in and is what every other language falls back to, key by key.
            if (locale.Split('-')[0] == "en")
            {
                return (null, $"{fileName} is an English pack. English is built into the console, and every other language falls back to it.");
            }

            if (Text(root, "name") is not { } name || name.Trim().Length == 0)
            {
                return (null, $"{fileName} does not give its language a name.");
            }

            var direction = Text(root, "direction") switch
            {
                "ltr" => (ConsoleLanguagePackDirection?)ConsoleLanguagePackDirection.Ltr,
                "rtl" => ConsoleLanguagePackDirection.Rtl,
                _ => null,
            };

            if (direction is null)
            {
                return (null, $"{fileName} does not say whether its text runs left to right or right to left.");
            }

            if (!root.TryGetProperty("catalog", out var catalog) || catalog.ValueKind != JsonValueKind.Object)
            {
                return (null, $"{fileName} holds no strings.");
            }

            return (new ConsoleLanguagePack
            {
                Version = number,
                Locale = locale,
                Name = name.Trim(),
                Direction = direction.Value,
                MadeFor = Text(root, "madeFor") ?? string.Empty,
                Catalog = catalog.EnumerateObject().ToDictionary(entry => entry.Name, entry => entry.Value.Clone(), StringComparer.Ordinal),
            }, null);
        }
    }

    /// <summary>
    /// A language tag in its canonical case (<c>pt-br</c> is <c>pt-BR</c>, <c>zh-hant</c> is
    /// <c>zh-Hant</c>), or null for something that is not one.
    /// </summary>
    public static string? Locale(string? tag)
    {
        if (string.IsNullOrWhiteSpace(tag))
        {
            return null;
        }

        var parts = tag.Trim().Replace('_', '-').Split('-');
        if (parts[0].Length is < 2 or > 3 || !parts[0].All(char.IsAsciiLetter))
        {
            return null;
        }

        var canonical = new List<string> { parts[0].ToLowerInvariant() };
        foreach (var part in parts.Skip(1))
        {
            if (part.Length is < 2 or > 8 || !part.All(char.IsAsciiLetterOrDigit))
            {
                return null;
            }

            canonical.Add(part.Length switch
            {
                2 when part.All(char.IsAsciiLetter) => part.ToUpperInvariant(),
                4 when part.All(char.IsAsciiLetter) => char.ToUpperInvariant(part[0]) + part[1..].ToLowerInvariant(),
                _ => part.ToLowerInvariant(),
            });
        }

        return string.Join('-', canonical);
    }

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
