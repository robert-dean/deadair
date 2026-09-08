using System.Text.RegularExpressions;

namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Manifest;

/// <summary>
/// Everything wrong with a manifest, listed rather than thrown.
/// </summary>
/// <remarks>
/// <para>
/// A list because an operator fixing a plugin they wrote should be told all of it at once. Pure, so
/// the rules can be read as a table, and never throwing, because refusing a plugin is an ordinary
/// outcome that ends in a sentence on a settings page rather than in an exception anybody handles.
/// </para>
/// <para>
/// It does not check the API range: that is the HOST's question, since only the host knows which
/// version it implements, and the answer is a different sentence.
/// </para>
/// </remarks>
public static partial class PluginManifestValidator
{
    /// <summary>Reverse-DNS, at least two parts. The station's own plugin id rule.</summary>
    [GeneratedRegex(@"^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$")]
    private static partial Regex IdPattern { get; }

    /// <summary>A semver triple. The plugin's own version, not a range.</summary>
    [GeneratedRegex(@"^\d+\.\d+\.\d+")]
    private static partial Regex VersionPattern { get; }

    /// <summary>Empty when there is nothing wrong with it.</summary>
    public static IReadOnlyList<string> Problems(PluginManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);

        var problems = new List<string>();

        if (!IdPattern.IsMatch(manifest.Id ?? string.Empty))
        {
            problems.Add($"""id "{manifest.Id}" is not reverse-DNS, like "deadair.bluos".""");
        }

        if (string.IsNullOrWhiteSpace(manifest.Name))
        {
            problems.Add("name is missing");
        }

        if (!VersionPattern.IsMatch(manifest.Version ?? string.Empty))
        {
            problems.Add($"""version "{manifest.Version}" is not a version like "0.1.0".""");
        }

        if (string.IsNullOrWhiteSpace(manifest.ApiVersion))
        {
            problems.Add("apiVersion is missing");
        }

        if (manifest.Entry is null || string.IsNullOrWhiteSpace(manifest.Entry.Assembly))
        {
            problems.Add("entry.assembly is missing");
        }

        if (manifest.Entry is null || string.IsNullOrWhiteSpace(manifest.Entry.Type))
        {
            problems.Add("entry.type is missing");
        }

        // A capability nobody implements is not a problem: the whole point of an open vocabulary is
        // that a plugin built for a later app loads here for whatever this one does understand.
        // What IS a problem is declaring nothing, since the host would have no reason to run it.
        if (manifest.Capabilities.Count == 0)
        {
            problems.Add("capabilities is empty, so nothing would ever ask this plugin for anything");
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var field in manifest.ConfigFields)
        {
            if (string.IsNullOrWhiteSpace(field.Key))
            {
                problems.Add("a config field has no key");
                continue;
            }

            if (!seen.Add(field.Key))
            {
                // Two fields with one key means the second silently wins on the way in and on the
                // way out, and nothing about the form would look wrong.
                problems.Add($"""two config fields share the key "{field.Key}".""");
            }

            if (string.IsNullOrWhiteSpace(field.Label))
            {
                problems.Add($"""config field "{field.Key}" has no label.""");
            }

            if (field.Type == PluginConfigFieldType.Select && field.Options.Count == 0)
            {
                problems.Add($"""config field "{field.Key}" is a select with no options.""");
            }
        }

        return problems;
    }
}
