using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// An enum as the word the station sends for it, and back.
/// </summary>
/// <remarks>
/// The generated SDK makes one enum per place a set of words appears, so a persona's brevity is
/// <c>PersonaBrevity</c> on the sheet and <c>PersonaDraftViewBrevity</c> on a generated draft, with the
/// same words behind both. Going through the wire word rather than the member name means a form holds
/// one string for a dial and never has to know which of the two it came from.
/// </remarks>
public static class Wire
{
    /// <summary>The word the station uses for a value, or empty for none or for one this build cannot spell.</summary>
    /// <remarks>
    /// A word the station added after this build's SDK was generated arrives as the enum's <c>Unknown</c>
    /// member, and the SDK refuses to spell that back. Throwing here took the whole persona page down
    /// for one dial, so an unspellable value reads as empty: the page opens, and that one dial shows the
    /// station's usual until somebody sets it.
    /// </remarks>
    public static string Name<T>(T? value)
        where T : struct, Enum
    {
        if (value is not { } set)
        {
            return string.Empty;
        }

        try
        {
            return JsonSerializer.Serialize(set, SdkJson.Options).Trim('"');
        }
        catch (JsonException)
        {
            return string.Empty;
        }
    }

    /// <summary>The value a word names, or null for an empty word or one the station does not use.</summary>
    public static T? Parse<T>(string? word)
        where T : struct, Enum
    {
        if (string.IsNullOrWhiteSpace(word))
        {
            return null;
        }

        try
        {
            // The SDK reads a word it does not know as the enum's zero member, `Unknown`, rather than
            // failing, and refuses to send that member back. So it is nothing here, or a save would
            // throw on the way out.
            var parsed = JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(word.Trim()), SdkJson.Options);
            return EqualityComparer<T>.Default.Equals(parsed, default) ? null : parsed;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
