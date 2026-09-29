using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// A subject's configuration between what the station stores and what the declared form draws.
/// </summary>
/// <remarks>
/// <para>
/// A subject kind declares its fields the way a plugin does, and the station stores what they hold as
/// it was sent, lists included. The form draws text, so a stored list becomes one entry per line when
/// its placeholder is written a line at a time and a comma-separated line otherwise, the console's
/// rule.
/// </para>
/// <para>
/// A save REPLACES a subject's configuration, where the form only reports what changed. So what is
/// sent is the stored configuration with the changes laid over it: a field nobody touched keeps the
/// value it had, in the shape it had, rather than vanishing from a partial write.
/// </para>
/// </remarks>
public static class TopicConfig
{
    /// <summary>What each declared field holds, as the text the form draws.</summary>
    public static Dictionary<string, JsonElement> Stored(TopicKindDescriptor kind, Topic? topic)
    {
        ArgumentNullException.ThrowIfNull(kind);

        var stored = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var field in kind.Fields)
        {
            if (topic?.Config.TryGetValue(field.Key, out var value) != true)
            {
                continue;
            }

            stored[field.Key] = value.ValueKind == JsonValueKind.Array
                ? JsonSerializer.SerializeToElement(string.Join(
                    (field.Placeholder ?? string.Empty).Contains('\n', StringComparison.Ordinal) ? "\n" : ", ",
                    value.EnumerateArray().Select(entry => entry.ValueKind == JsonValueKind.String ? entry.GetString() : entry.GetRawText())))
                : value;
        }

        return stored;
    }

    /// <summary>The stored configuration with the form's changes laid over it.</summary>
    public static Dictionary<string, JsonElement> Merge(Topic? topic, IReadOnlyDictionary<string, JsonElement> changed)
    {
        ArgumentNullException.ThrowIfNull(changed);

        var config = topic is null
            ? new Dictionary<string, JsonElement>(StringComparer.Ordinal)
            : new Dictionary<string, JsonElement>(topic.Config, StringComparer.Ordinal);

        foreach (var (key, value) in changed)
        {
            config[key] = value;
        }

        return config;
    }

    /// <summary>A subject as one line: how many entries each field holds, or that it matches nothing.</summary>
    public static string Summary(Topic topic, TopicKindDescriptor kind)
    {
        ArgumentNullException.ThrowIfNull(topic);
        ArgumentNullException.ThrowIfNull(kind);

        var parts = kind.Fields
            .Select(field => (field.Label, Count: topic.Config.TryGetValue(field.Key, out var value) ? Entries(value) : 0))
            .Where(field => field.Count > 0)
            .Select(field => $"{field.Label}: {field.Count}")
            .ToList();

        return parts.Count == 0 ? "nothing to match yet" : string.Join(" · ", parts);
    }

    private static int Entries(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Array => value.EnumerateArray().Count(entry => entry.ValueKind != JsonValueKind.String || entry.GetString()?.Trim().Length > 0),
        JsonValueKind.String => (value.GetString() ?? string.Empty).Split(['\n', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Length,
        JsonValueKind.Null or JsonValueKind.Undefined => 0,
        _ => 1,
    };
}
