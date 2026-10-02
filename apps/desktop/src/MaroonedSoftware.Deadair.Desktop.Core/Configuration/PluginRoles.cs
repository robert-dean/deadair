using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>A heading the station's plugins are listed under, and the capabilities that put a plugin there.</summary>
public sealed record PluginRole(string Title, IReadOnlyList<string> Capabilities);

/// <summary>A role and the plugins under it, alphabetical.</summary>
public sealed record PluginGroup(PluginRole Role, IReadOnlyList<PluginSummary> Plugins);

/// <summary>
/// The station's plugins by what they are FOR: the console's <c>plugin.roles.ts</c>, ported with its
/// words.
/// </summary>
/// <remarks>
/// <para>
/// A plugin is listed once, under the FIRST role any of its capabilities names, in this order. That
/// is a choice rather than a fact: Spotify is a library and a player and a scrobbler, and it sits under
/// Music sources because that is the question somebody opening this list is asking about it.
/// </para>
/// <para>
/// A capability this app has no word for is shown by its own name, and a plugin none of whose
/// capabilities any role names is listed under Other rather than dropped, so a plugin of a kind that
/// did not exist when this was written still appears.
/// </para>
/// </remarks>
public static class PluginRoles
{
    public static IReadOnlyList<PluginRole> All { get; } =
    [
        new("Music sources", ["catalog", "stream"]),
        new("Voice", ["speech"]),
        new("Writing", ["llm"]),
        new("Audio", ["analysis", "mixer", "transcode"]),
        new("Knowledge", ["enrichment", "similarity", "search", "scrobble"]),
        new("News & programmes", ["news", "weather", "podcast", "almanac", "charts"]),
    ];

    public static PluginRole Other { get; } = new("Other", []);

    /// <summary>The capability a plugin declares when it can walk an operator through a provider's consent screen.</summary>
    public const string OAuth = "oauth";

    public static PluginRole Of(IReadOnlyList<string> capabilities)
    {
        ArgumentNullException.ThrowIfNull(capabilities);
        return All.FirstOrDefault(role => role.Capabilities.Any(capabilities.Contains)) ?? Other;
    }

    /// <summary>The plugins under each role that has any, in the roles' order.</summary>
    public static IReadOnlyList<PluginGroup> Group(IEnumerable<PluginSummary> plugins)
    {
        ArgumentNullException.ThrowIfNull(plugins);

        var list = plugins.ToList();
        return [.. All.Append(Other)
            .Select(role => new PluginGroup(
                role,
                [.. list.Where(plugin => Of(plugin.Capabilities) == role).OrderBy(plugin => plugin.Name, StringComparer.CurrentCultureIgnoreCase)]))
            .Where(group => group.Plugins.Count > 0)];
    }

    /// <summary>Whether a plugin wants somebody to do something about it.</summary>
    public static bool NeedsAttention(PluginStatus status) => status is PluginStatus.Failed or PluginStatus.Misconfigured;

    /// <summary>What a capability is called, or its own name for one this app does not know.</summary>
    public static string Label(string capability) => capability switch
    {
        "catalog" => "Library",
        "stream" => "Plays records",
        "steer" => "Steers playback",
        "speech" => "Voice",
        "llm" => "Writing",
        "analysis" => "Measures records",
        "mixer" => "Joins audio",
        "transcode" => "Makes copies to share",
        "enrichment" => "Record details",
        "similarity" => "Who sounds like whom",
        "search" => "Web search",
        "scrobble" => "Scrobbling",
        "news" => "News",
        "weather" => "Weather",
        "podcast" => "Podcasts",
        "almanac" => "On this day",
        "charts" => "Charts",
        OAuth => "Sign-in",
        _ => capability,
    };

    /// <summary>The first line of a description, which is all a row has room for.</summary>
    public static string FirstLine(string? text) =>
        text is null ? string.Empty : text.Split('\n', 2)[0].Trim();
}
