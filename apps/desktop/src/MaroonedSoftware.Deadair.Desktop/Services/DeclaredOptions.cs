using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>
/// The choices a field says only the console can list: the station's news categories, its feeds,
/// its shows, its series, the world's time zones, the plugins holding a capability, and the models the
/// model plugin offers.
/// </summary>
/// <remarks>
/// Asked for only when a form names the source, and each source is one read. The mapping is the web
/// console's (`declared.options.ts`), so the two consoles offer the same choices for the same field.
/// </remarks>
public sealed class DeclaredOptions(OperatorActions actions, HttpClient http)
{
    private static readonly Dictionary<ConfigFieldOptionSource, string> Capabilities = new()
    {
        [ConfigFieldOptionSource.PluginsSpeech] = "speech",
        [ConfigFieldOptionSource.PluginsLlm] = "llm",
        [ConfigFieldOptionSource.PluginsMixer] = "mixer",
        [ConfigFieldOptionSource.PluginsAnalysis] = "analysis",
        [ConfigFieldOptionSource.PluginsSimilarity] = "similarity",
    };

    public async Task<IReadOnlyDictionary<ConfigFieldOptionSource, IReadOnlyList<ConfigFieldOption>>> ResolveAsync(
        StationUrl station,
        IReadOnlySet<ConfigFieldOptionSource> wanted,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(wanted);

        var resolved = new Dictionary<ConfigFieldOptionSource, IReadOnlyList<ConfigFieldOption>>();
        if (wanted.Count == 0)
        {
            return resolved;
        }

        using var sdk = new DeadairSdk(new SdkOptions { BaseUrl = station.ApiBase, HttpClient = http });

        if (wanted.Contains(ConfigFieldOptionSource.StationNewsCategories))
        {
            var topics = await actions.RunAsync(token => sdk.Topics.ListTopicsAsync(null, token), cancellationToken: cancellationToken)
                .ConfigureAwait(true);
            resolved[ConfigFieldOptionSource.StationNewsCategories] = topics is null
                ? []
                : [.. topics.Topics.Where(topic => topic.Kind == "news").Select(topic => Option(topic.Key, topic.Label))];
        }

        if (wanted.Contains(ConfigFieldOptionSource.StationNewsFeeds))
        {
            var feeds = await actions.RunAsync(token => sdk.News.ListFeedsAsync(token), cancellationToken: cancellationToken)
                .ConfigureAwait(true);
            resolved[ConfigFieldOptionSource.StationNewsFeeds] = feeds is null ? [] : [.. feeds.Feeds.Select(feed => Option(feed.Id, feed.Name))];
        }

        if (wanted.Contains(ConfigFieldOptionSource.StationPodcastShows))
        {
            var shows = await actions.RunAsync(token => sdk.Podcasts.ListShowsAsync(token), cancellationToken: cancellationToken)
                .ConfigureAwait(true);
            resolved[ConfigFieldOptionSource.StationPodcastShows] = shows is null ? [] : [.. shows.Shows.Select(show => Option(show.Id, show.Title))];
        }

        if (wanted.Contains(ConfigFieldOptionSource.StationNarrationSeries))
        {
            var series = await actions.RunAsync(token => sdk.Narrations.ListSeriesAsync(token), cancellationToken: cancellationToken)
                .ConfigureAwait(true);
            resolved[ConfigFieldOptionSource.StationNarrationSeries] = series is null ? [] : [.. series.Series.Select(one => Option(one.Id, one.Title))];
        }

        if (wanted.Contains(ConfigFieldOptionSource.IntlTimeZones))
        {
            resolved[ConfigFieldOptionSource.IntlTimeZones] = [.. TimeZoneInfo.GetSystemTimeZones()
                .Select(zone => TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out var iana) ? iana : zone.Id)
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
                .Select(zone => Option(zone, zone))];
        }

        var needsPlugins = wanted.Any(Capabilities.ContainsKey);
        var needsModels = wanted.Contains(ConfigFieldOptionSource.LlmModels);

        if (needsPlugins)
        {
            var plugins = await actions.RunAsync(token => sdk.Plugins.ListPluginsAsync(token), cancellationToken: cancellationToken)
                .ConfigureAwait(true) ?? [];

            foreach (var (source, capability) in Capabilities.Where(pair => wanted.Contains(pair.Key)))
            {
                resolved[source] = [.. plugins
                    .Where(plugin => plugin.Enabled && plugin.Capabilities.Contains(capability))
                    .Select(plugin => Option(plugin.Id, plugin.Name))];
            }
        }

        if (needsModels)
        {
            // The models are whatever the plugin providing `llm` suggests for its own `model` field.
            var providers = await actions.RunAsync(token => sdk.Plugins.ListCapabilityProvidersAsync(token), cancellationToken: cancellationToken)
                .ConfigureAwait(true);
            var pluginId = providers?.Capabilities
                .FirstOrDefault(capability => capability.Capability == "llm")?
                .Candidates.FirstOrDefault(candidate => candidate.InUse)?.PluginId;

            var suggested = pluginId is null
                ? null
                : await actions.RunAsync(token => sdk.Plugins.SuggestPluginConfigOptionsAsync(pluginId, token), cancellationToken: cancellationToken)
                    .ConfigureAwait(true);

            resolved[ConfigFieldOptionSource.LlmModels] = suggested is not null && suggested.Fields.TryGetValue("model", out var models)
                ? models
                : [];
        }

        return resolved;
    }

    private static ConfigFieldOption Option(string value, string label) => new() { Value = value, Label = label };
}
