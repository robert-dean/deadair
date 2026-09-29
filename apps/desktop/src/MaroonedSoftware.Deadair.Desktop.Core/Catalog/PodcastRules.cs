using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>Where an episode is, from the station's point of view.</summary>
public enum EpisodeState
{
    Aired,
    Ready,
    Fetching,
    Failed,
    Unfetched,
}

/// <summary>A write that subscribes the station to a show: one field of the podcast plugin's configuration.</summary>
/// <param name="FieldKey">The list field that holds the feeds.</param>
/// <param name="Value">The whole list, as the JSON array in a string that a list field stores.</param>
/// <param name="AlreadyThere">Whether the show was in the list already, so the write changes nothing.</param>
/// <param name="Unreadable">Whether the list there now could not be read, in which case nothing may be written.</param>
public sealed record Subscription(string FieldKey, string Value, bool AlreadyThere, bool Unreadable = false);

/// <summary>
/// The rules of the Podcasts tab, from the web console's podcasts page.
/// </summary>
public static class PodcastRules
{
    /// <summary>
    /// How long a fetch that was asked for is drawn as in flight. It is a job the station runs, and
    /// one that has not answered after this long is drawn as whatever it was before rather than as
    /// fetching forever.
    /// </summary>
    public static readonly TimeSpan FetchingFor = TimeSpan.FromMinutes(20);

    /// <remarks>
    /// Asked in order: an aired episode is aired whatever else is true of it, and one that was asked
    /// for recently is fetching even though its last attempt failed, because that attempt is the
    /// reason it was asked for again.
    /// </remarks>
    public static EpisodeState State(StationEpisode episode, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(episode);

        if (episode.AiredAt is not null)
        {
            return EpisodeState.Aired;
        }

        if (episode.Fetched)
        {
            return EpisodeState.Ready;
        }

        if (DateTimeOffset.TryParse(episode.FetchRequestedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var asked)
            && now - asked < FetchingFor)
        {
            return EpisodeState.Fetching;
        }

        return episode.FetchError is not null ? EpisodeState.Failed : EpisodeState.Unfetched;
    }

    public static (StatusTone Tone, string Label) Describe(EpisodeState state) => state switch
    {
        EpisodeState.Aired => (StatusTone.Off, "Aired"),
        EpisodeState.Ready => (StatusTone.Ok, "Ready to air"),
        EpisodeState.Fetching => (StatusTone.Standby, "Fetching"),
        EpisodeState.Failed => (StatusTone.Fault, "Could not fetch"),
        _ => (StatusTone.Off, "Not fetched"),
    };

    /// <summary>An episode can be asked for while it is neither here nor already on its way.</summary>
    public static bool CanFetch(EpisodeState state) => state is EpisodeState.Failed or EpisodeState.Unfetched;

    /// <summary>
    /// The podcast plugin's configuration with one more show in its feed list, or null when the
    /// plugin keeps no list this can add to.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The same write the web console makes: the first list field with a URL column is the feed list,
    /// the new row carries the feed address and, where the list has a text column, the show's title.
    /// Every row already there is kept exactly as it was, so a row's own id and any column this app
    /// does not know survive the save. A show already in the list is not added twice.
    /// </para>
    /// <para>
    /// A list is stored as a JSON array in a string. A value that is already an array is read too,
    /// where the console would read it as empty: reading it as empty and writing back one row would
    /// delete every other subscription.
    /// </para>
    /// </remarks>
    public static Subscription? With(
        IReadOnlyList<ConfigFieldDescriptor> fields,
        IReadOnlyDictionary<string, JsonElement> config,
        string title,
        string feedUrl)
    {
        ArgumentNullException.ThrowIfNull(fields);
        ArgumentNullException.ThrowIfNull(config);

        var field = fields.FirstOrDefault(each =>
            each.Type == ConfigFieldType.List && (each.Columns ?? []).Any(column => column.Type == ConfigFieldColumnType.Url));
        if (field is null)
        {
            return null;
        }

        var urlColumn = field.Columns!.First(column => column.Type == ConfigFieldColumnType.Url).Key;
        var nameColumn = field.Columns!.FirstOrDefault(column => column.Type == ConfigFieldColumnType.String)?.Key;

        // A list that is there and cannot be read is refused rather than replaced: writing one row over
        // it would delete every subscription it held.
        if (Rows(config.TryGetValue(field.Key, out var value) ? value : default) is not { } rows)
        {
            return new Subscription(field.Key, string.Empty, AlreadyThere: false, Unreadable: true);
        }

        var there = rows.Any(row => row[urlColumn]?.GetValueKind() == JsonValueKind.String && row[urlColumn]!.GetValue<string>() == feedUrl);

        if (!there)
        {
            var added = new JsonObject { [urlColumn] = feedUrl };
            if (nameColumn is not null)
            {
                added[nameColumn] = title;
            }

            rows.Add(added);
        }

        var array = new JsonArray([.. rows]);
        return new Subscription(field.Key, array.ToJsonString(), there);
    }

    private static List<JsonObject>? Rows(JsonElement value)
    {
        JsonNode? parsed = null;
        try
        {
            parsed = value.ValueKind switch
            {
                JsonValueKind.String when !string.IsNullOrWhiteSpace(value.GetString()) => JsonNode.Parse(value.GetString()!),
                JsonValueKind.Array => JsonNode.Parse(value.GetRawText()),
                _ => null,
            };
        }
        catch (JsonException)
        {
            return null;
        }

        return parsed switch
        {
            JsonArray array => [.. array.OfType<JsonObject>().Select(row => (JsonObject)row.DeepClone())],
            null => [],
            _ => null,
        };
    }
}
