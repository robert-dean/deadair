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
    /// <summary>The word the station uses for a value, or empty for none.</summary>
    public static string Name<T>(T? value)
        where T : struct, Enum =>
        value is { } set ? JsonSerializer.Serialize(set, SdkJson.Options).Trim('"') : string.Empty;

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
            return JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(word.Trim()), SdkJson.Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
