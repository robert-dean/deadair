using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Manifest;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>
/// A manifest, or the reason there isn't one.
/// </summary>
/// <param name="Manifest">The manifest, when it could be read and made sense.</param>
/// <param name="Problem">Why not, in words an operator can act on.</param>
public readonly record struct PluginManifestReading(PluginManifest? Manifest, string? Problem)
{
    public bool Ok => Manifest is not null;
}

/// <summary>
/// Turns a <c>plugin.json</c> into a manifest, and never throws doing it.
/// </summary>
/// <remarks>
/// <para>
/// Every failure here is somebody else's typo in a file this app did not write, so all of them are
/// values. A loader that threw would have to be wrapped at every call and one missed wrap would take
/// the app down over a stray comma in a plugin nobody has enabled.
/// </para>
/// <para>
/// Unknown members are ignored rather than refused, which is what lets a plugin written for a later
/// version of the contract still be read here — the api range is what decides whether to run it.
/// </para>
/// </remarks>
public static class PluginManifestReader
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>Reads the text of a manifest.</summary>
    public static PluginManifestReading Read(string json)
    {
        PluginManifest? manifest;

        try
        {
            manifest = JsonSerializer.Deserialize<PluginManifest>(json, Options);
        }
        catch (JsonException error)
        {
            // The message carries a line and position, which is the one thing that makes a JSON
            // error worth showing somebody rather than just "invalid".
            return new PluginManifestReading(null, $"{PluginApiFile} could not be read: {error.Message}");
        }

        if (manifest is null)
        {
            return new PluginManifestReading(null, $"{PluginApiFile} is empty");
        }

        var problems = PluginManifestValidator.Problems(manifest);

        return problems.Count == 0
            ? new PluginManifestReading(manifest, null)
            : new PluginManifestReading(null, string.Join("; ", problems));
    }

    /// <summary>Reads the file, if it is there and can be opened.</summary>
    public static PluginManifestReading ReadFile(string path)
    {
        try
        {
            return Read(File.ReadAllText(path));
        }
        catch (IOException error)
        {
            return new PluginManifestReading(null, $"{PluginApiFile} could not be opened: {error.Message}");
        }
        catch (UnauthorizedAccessException error)
        {
            return new PluginManifestReading(null, $"{PluginApiFile} could not be opened: {error.Message}");
        }
    }

    private static string PluginApiFile => PluginSdk.PluginApi.ManifestFileName;
}
