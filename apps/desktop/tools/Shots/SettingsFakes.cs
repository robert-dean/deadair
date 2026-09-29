using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
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

    private static void Pose(SettingsViewModel settings, SettingsSectionId id)
    {
        switch (id)
        {
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
