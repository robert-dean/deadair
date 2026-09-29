using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Destination = MaroonedSoftware.Deadair.Desktop.Navigation.Destination;

namespace Shots;

/// <summary>
/// The Settings page opened on one of its sections, with what a real station answers for it.
/// </summary>
/// <remarks>
/// Kept apart from <c>Fakes</c> so the page's fixtures live in one place. Showing a section reads it,
/// and the shots' client refuses everything, so each section is posed AFTER it is shown and the
/// refusal that reading left at the foot of the page is taken away again: a frame of a section is a
/// frame of the section, not of a station that would not answer.
/// </remarks>
internal static class SettingsFakes
{
    /// <param name="nowPlaying">
    /// Whether the Now playing panel is open. Closed, the page is wide enough for its list of
    /// sections; open, at the app's own size, the list is a box above the section.
    /// </param>
    public static MainWindowContent Frame(SettingsSectionId id, bool nowPlaying = true)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        shell.ShowNowPlaying = nowPlaying;
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Settings());
        shell.Navigation.Show(new Destination.Settings());

        var settings = shell.StationSettings;
        var entry = settings.StationSections.FirstOrDefault(section => section.Id == id) ?? settings.AppSection;
        settings.ShowSectionCommand.Execute(entry);

        Pose(settings, id);
        shell.Dialogs.Notice = null;

        return new MainWindowContent { Shell = shell };
    }

    /// <summary>A station plugin's own page, opened from the Plugins section, posed mid-way through being set up.</summary>
    public static MainWindowContent Plugin(bool nowPlaying = true)
    {
        var shell = Fakes.Shell(operatorSignedIn: true);
        shell.ShowNowPlaying = nowPlaying;
        Fakes.PutOnAir(shell.Listener);
        Fakes.Fill(shell, new Destination.Settings());
        shell.Navigation.Show(new Destination.Settings());
        shell.Navigation.Push(new Destination.PluginDetail("deadair.spotify", "Spotify"));

        var page = (StationPluginViewModel)shell.Details.Current!;
        page.Present(Spotify());
        page.PresentGrants(new PluginGrantList
        {
            Grants =
            [
                new()
                {
                    PluginId = "deadair.spotify",
                    PluginName = "Spotify",
                    Capability = "net:api.spotify.com",
                    Label = "Reach api.spotify.com",
                    Describes = "Outbound HTTPS to one host that is not in the plugin's manifest.",
                    Reason = "Spotify moved its library endpoints to a host this version's manifest does not name yet.",
                    Decision = GrantDecision.Denied,
                },
            ],
        });
        page.Fetcher = new FetcherAuthorization
        {
            Configured = true,
            Reachable = true,
            Authorized = false,
            Session = false,
            LoginError = "Bad credentials: the refresh token was revoked by the account holder on 2026-09-27.",
        };
        page.PresentLog(new PluginLogPage
        {
            PluginId = "deadair.spotify",
            Level = PluginLogLevel.Info,
            Entries =
            [
                new() { Ts = "2026-09-29T14:31:07Z", Level = PluginLogLevel.Info, Text = "library sync: 12,904 records, 311 playlists" },
                new() { Ts = "2026-09-29T14:31:09Z", Level = PluginLogLevel.Warn, Text = "rate limited on /v1/me/tracks, retrying after 30 seconds as the Retry-After header asked" },
                new() { Ts = "2026-09-29T14:32:40Z", Level = PluginLogLevel.Error, Text = "token refresh refused: invalid_grant" },
            ],
        });
        page.TestTone = StatusTone.Fault;
        page.TestResult = "The plugin is not signed in to Spotify, so it cannot reach your library.";
        shell.Dialogs.Notice = null;

        return new MainWindowContent { Shell = shell };
    }

    private static PluginDetail Spotify() => new()
    {
        Id = "deadair.spotify",
        Name = "Spotify",
        Version = "2.4.1",
        Description = "Your Spotify library as the station's record collection, and the audio fetched for air by the station's own track fetcher.",
        Capabilities = ["catalog", "stream", "scrobble", "oauth"],
        UsesTrackFetcher = true,
        Status = PluginStatus.Misconfigured,
        Origin = PluginOrigin.Installed,
        Enabled = true,
        FirstEnabledAt = new DateTimeOffset(2026, 9, 1, 9, 0, 0, TimeSpan.Zero),
        LastError = "The client secret was rejected by accounts.spotify.com (invalid_client).",
        Dir = "/var/lib/deadair/plugins/deadair-spotify",
        OauthConnected = false,
        LogLevel = PluginLogLevel.Info,
        ConfigFields =
        [
            new() { Key = "clientId", Label = "Client id", Type = ConfigFieldType.String, Required = true, Help = "From the app you registered at developer.spotify.com." },
            new() { Key = "clientSecret", Label = "Client secret", Type = ConfigFieldType.Secret, Required = true },
            new() { Key = "redirectUri", Label = "Redirect address", Type = ConfigFieldType.Url, Help = "The callback address below, character for character." },
            new() { Key = "market", Label = "Market", Type = ConfigFieldType.Select, Options = [new() { Value = "GB", Label = "United Kingdom" }, new() { Value = "US", Label = "United States" }] },
            new() { Key = "scrobble", Label = "Scrobble what airs", Type = ConfigFieldType.Boolean },
        ],
        SecretsConfigured = new Dictionary<string, bool> { ["clientSecret"] = true },
        Config = new Dictionary<string, JsonElement>
        {
            ["clientId"] = JsonSerializer.SerializeToElement("4f1c2a9e0b7d4c55a1e3f09b2d6c8a17"),
            ["redirectUri"] = JsonSerializer.SerializeToElement("https://radio.example.com/plugins/deadair.spotify/oauth/callback"),
            ["market"] = JsonSerializer.SerializeToElement("GB"),
            ["scrobble"] = JsonSerializer.SerializeToElement(true),
        },
    };

    private static PluginSummary Summary(string id, string name, string version, string description, PluginStatus status, bool enabled, PluginOrigin origin, params string[] capabilities) => new()
    {
        Id = id,
        Name = name,
        Version = version,
        Description = description,
        Status = status,
        Enabled = enabled,
        Origin = origin,
        Capabilities = [.. capabilities],
        ConfigFields = [],
        SecretsConfigured = [],
    };

    private static void Pose(SettingsViewModel settings, SettingsSectionId id)
    {
        switch (id)
        {
            case SettingsSectionId.Plugins:
                settings.StationPlugins.Present(
                [
                    Summary("deadair.spotify", "Spotify", "2.4.1", "Your Spotify library as the station's record collection.", PluginStatus.Misconfigured, true, PluginOrigin.Installed, "catalog", "stream", "scrobble", "oauth"),
                    Summary("deadair.navidrome", "Navidrome", "1.9.0", "A Navidrome or Subsonic server as the record collection, streamed from its own URLs.", PluginStatus.Active, true, PluginOrigin.Bundled, "catalog", "stream"),
                    Summary("deadair.chatterbox", "Chatterbox", "0.8.3", "Cloned voices for every persona, on a GPU somewhere on your network.", PluginStatus.Active, true, PluginOrigin.Bundled, "speech"),
                    Summary("deadair.kokoro", "Kokoro", "0.5.0", "A small, fast voice that runs anywhere.", PluginStatus.Disabled, false, PluginOrigin.Bundled, "speech"),
                    Summary("deadair.llm", "Language model", "3.1.0", "Writes what the presenter says between records, through whichever model you point it at.", PluginStatus.Active, true, PluginOrigin.Bundled, "llm"),
                    Summary("deadair.weather", "Weather", "1.2.0", "Open-Meteo, the US National Weather Service or OpenWeatherMap.", PluginStatus.Failed, true, PluginOrigin.Bundled, "weather"),
                    Summary("somebody.telepathy", "Telepathy with a very long plugin name that has to trim somewhere", "0.0.1-alpha.7", "Something nobody has a word for yet.", PluginStatus.Discovered, false, PluginOrigin.Installed, "telepathy"),
                ]);
                break;

            case SettingsSectionId.Artwork:
                settings.Artwork.Present(new BreakArtworkList
                {
                    Breaks =
                    [
                        new() { Kind = "news", Url = "art/1f0c/cover.png", Source = BreakArtworkSource.Shipped, HasShipped = true },
                        new() { Kind = "weather", Url = "art/2a9e/cover.jpg", Source = BreakArtworkSource.Operator, HasShipped = true },
                        new() { Kind = "phone-in with a caller who has a long story", Url = "art/77b1/cover.webp", Source = BreakArtworkSource.Operator, HasShipped = false },
                    ],
                });
                break;

            case SettingsSectionId.Storage:
                settings.Storage.Present(new StorageReport
                {
                    ReadAt = new DateTimeOffset(2026, 9, 29, 14, 32, 0, TimeSpan.Zero),
                    TotalBytes = 61_734_000_000,
                    TotalFiles = 48_213,
                    Stores =
                    [
                        new() { Id = StorageStoreId.Tracks, Label = "Records", Path = "/var/lib/deadair/tracks", Files = 12_904, Bytes = 48_800_000_000, CapBytes = 50_000_000_000, OrphanFiles = 3, OrphanBytes = 21_400_000, RowsWithNoFile = 17 },
                        new() { Id = StorageStoreId.Art, Label = "Artwork", Path = "/var/lib/deadair/art", Files = 9_311, Bytes = 1_204_000_000, OrphanFiles = 0, OrphanBytes = 0, RowsWithNoFile = 0 },
                        new() { Id = StorageStoreId.Segments, Label = "What the station has said", Path = "/var/lib/deadair/segments/rendered/with/a/long/path/that/has/to/trim", Files = 25_870, Bytes = 11_530_000_000, OrphanFiles = 41, OrphanBytes = 318_000_000, RowsWithNoFile = 0 },
                        new() { Id = StorageStoreId.Voices, Label = "Voices", Path = "/var/lib/deadair/voices", Files = 128, Bytes = 200_000_000, OrphanFiles = 0, OrphanBytes = 0, RowsWithNoFile = 0 },
                    ],
                });
                break;

            case SettingsSectionId.Providers:
                settings.Providers.Present(new ProviderCatalogue
                {
                    Capabilities =
                    [
                        new()
                        {
                            Capability = "speech",
                            Mode = ProviderMode.One,
                            SettingKey = "providers.speech",
                            Configured = string.Empty,
                            Stale = [],
                            Unanswered = false,
                            Candidates =
                            [
                                Candidate("deadair.chatterbox", "Chatterbox", PluginStatus.Active, position: 0, inUse: true),
                                Candidate("deadair.kokoro", "Kokoro", PluginStatus.Active, position: 1),
                                Candidate("deadair.rhapsode", "Rhapsode (several engines on one server)", PluginStatus.Misconfigured, position: null, enabled: true),
                            ],
                        },
                        new()
                        {
                            Capability = "similarity",
                            Mode = ProviderMode.Ordered,
                            SettingKey = "providers.similarity",
                            Configured = """[{"source":"deadair.lastfm"},{"source":"deadair.deezer"},{"source":"somebody.gone"}]""",
                            Stale = ["somebody.gone"],
                            Unanswered = false,
                            Candidates =
                            [
                                Candidate("deadair.lastfm", "Last.fm", PluginStatus.Active, position: 0, inUse: true),
                                Candidate("deadair.deezer", "Deezer", PluginStatus.Active, position: 1, inUse: true),
                                Candidate("deadair.musicbrainz", "MusicBrainz", PluginStatus.Active, position: 2, inUse: true),
                                Candidate("deadair.listenbrainz", "ListenBrainz", PluginStatus.Disabled, position: null, enabled: false),
                            ],
                        },
                        new()
                        {
                            Capability = "mixer",
                            Mode = ProviderMode.One,
                            SettingKey = "providers.mixer",
                            Configured = string.Empty,
                            Stale = [],
                            Unanswered = false,
                            Candidates = [Candidate("deadair.analyzer", "Analyzer", PluginStatus.Active, position: 0, inUse: true)],
                        },
                    ],
                });
                break;

            case SettingsSectionId.Grants:
                settings.Grants.Present(new PluginGrantList
                {
                    Grants =
                    [
                        new()
                        {
                            PluginId = "deadair.websearch",
                            PluginName = "Web search",
                            Capability = "net:search.brave.com",
                            Label = "Reach search.brave.com",
                            Describes = "Outbound HTTPS to one host that is not in the plugin's manifest.",
                            Reason = "The operator chose Brave as the search backend in this plugin's settings, and Brave answers from its own address.",
                            Decision = GrantDecision.Denied,
                        },
                        new()
                        {
                            PluginId = "somebody.sonos",
                            PluginName = "Sonos speakers, from somebody else entirely",
                            Capability = "fs:read",
                            Label = "Read the station's rendered segments",
                            Describes = "Read access to the segments directory.",
                            Reason = "To hand a speaker the file rather than the stream.",
                            Decision = GrantDecision.Allowed,
                        },
                    ],
                });
                break;
        }
    }

    private static ProviderCandidate Candidate(string id, string name, PluginStatus status, long? position, bool inUse = false, bool enabled = true) =>
        new() { PluginId = id, Name = name, Status = status, Position = position, InUse = inUse, Enabled = enabled, Listed = position is not null };
}
