using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>A show in the choice above the episodes. A null id is every show.</summary>
public sealed record ShowChoiceViewModel(string? Id, string Title)
{
    public override string ToString() => Title;
}

/// <summary>One episode of a show the station carries.</summary>
public sealed class EpisodeRowViewModel
{
    public EpisodeRowViewModel(StationEpisode episode, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(episode);

        Episode = episode;
        var state = PodcastRules.State(episode, now);
        (Tone, State) = PodcastRules.Describe(state);
        CanFetch = PodcastRules.CanFetch(state);
        FetchLabel = episode.FetchError is null ? "Fetch now" : "Try again";

        var facts = new List<string>();
        if (episode.Explicit == true)
        {
            facts.Add("Explicit");
        }

        if (episode.PublishedAt is { } published)
        {
            facts.Add(NewsViewModel.When(published));
        }

        if (episode.DurationMs is > 0)
        {
            facts.Add(CatalogPaging.Length(episode.DurationMs));
        }

        Facts = string.Join(" · ", facts);

        When = episode.AiredAt is { } aired
            ? $"Aired {NewsViewModel.When(aired)}."
            : episode.ScheduledFor is { } wanted
                ? $"Wanted for {NewsViewModel.When(wanted)}."
                : null;

        Failure = episode.FetchError is { } error && !episode.Fetched ? $"The last attempt failed: {error}." : null;
        Url = Uri.TryCreate(episode.Url, UriKind.Absolute, out var url) && url.Scheme is "http" or "https" ? url : null;
    }

    public StationEpisode Episode { get; }

    public string Id => Episode.Id;

    public string Show => Episode.ShowTitle;

    public string Title => Episode.Title;

    public string? Summary => string.IsNullOrWhiteSpace(Episode.Summary) ? null : Episode.Summary;

    public bool HasSummary => Summary is not null;

    public StatusTone Tone { get; }

    public string State { get; }

    /// <summary>Explicit, when it was published, and how long it is.</summary>
    public string Facts { get; }

    /// <summary>When it aired, or when a band on the clock wants it.</summary>
    public string? When { get; }

    public bool HasWhen => When is not null;

    public string? Failure { get; }

    public bool HasFailure => Failure is not null;

    public Uri? Url { get; }

    public bool HasUrl => Url is not null;

    /// <summary>Offered while the episode is neither here nor already on its way.</summary>
    public bool CanFetch { get; }

    public string FetchLabel { get; }
}

/// <summary>A show the podcast plugin's directory found.</summary>
public sealed partial class DirectoryRowViewModel(StationDirectoryEntry entry, bool subscribed) : ObservableObject
{
    public StationDirectoryEntry Entry { get; } = entry;

    public string Title => Entry.Title;

    public string? Author => Entry.Author;

    public bool HasAuthor => Author is not null;

    public string FeedUrl => Entry.FeedUrl;

    [ObservableProperty]
    private bool _subscribed = subscribed;
}

/// <summary>
/// The shows the station carries, their episodes, and finding another in a directory.
/// </summary>
/// <remarks>
/// <para>
/// A <c>syndicated</c> band on the format clock airs a show's newest episode at its time, and the
/// station fetches the audio a few hours before; Fetch now is for wanting it sooner, or again after a
/// failure. The feeds are read every half hour, and Read the feeds now asks for that at once.
/// </para>
/// <para>
/// Subscribing writes the podcast plugin's own configuration, exactly as the web console does: the
/// show's feed is added to the plugin's list of feeds (<see cref="PodcastRules.With"/>) and the feeds
/// are read again. The directory search is an operator action rather than a read, since the words go
/// to somebody else's directory, which is why the station answers it only for somebody who manages it.
/// </para>
/// </remarks>
public sealed partial class PodcastsViewModel(OperatorActions actions, HttpClient http, TimeProvider? time = null)
    : LibraryTabViewModel(actions, http)
{
    private const long DirectoryResults = 20;

    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private readonly HashSet<string> _carried = new(StringComparer.Ordinal);

    public ObservableCollection<ShowChoiceViewModel> Shows { get; } = [];

    public ObservableCollection<EpisodeRowViewModel> Episodes { get; } = [];

    public ObservableCollection<DirectoryRowViewModel> Results { get; } = [];

    [ObservableProperty]
    private ShowChoiceViewModel? _show;

    [ObservableProperty]
    private string? _empty;

    [ObservableProperty]
    private string _query = string.Empty;

    [ObservableProperty]
    private string? _noResults;

    public bool HasShows => Shows.Count > 1;

    partial void OnShowChanged(ShowChoiceViewModel? value)
    {
        if (value is not null && Shows.Count > 0)
        {
            _ = ReadEpisodesAsync(CancellationToken.None);
        }
    }

    protected override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        var shows = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Podcasts.ListShowsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (shows is null)
        {
            return false;
        }

        PresentShows(shows);
        return await ReadEpisodesAsync(cancellationToken).ConfigureAwait(true);
    }

    /// <summary>Draws the shows the station carries. Public so a frame can be posed from them.</summary>
    public void PresentShows(StationShowList shows)
    {
        ArgumentNullException.ThrowIfNull(shows);

        _carried.Clear();
        foreach (var feed in shows.Shows.Select(show => show.FeedUrl).OfType<string>())
        {
            _carried.Add(feed);
        }

        Shows.Clear();
        Shows.Add(new ShowChoiceViewModel(null, "Every show"));
        foreach (var show in shows.Shows)
        {
            Shows.Add(new ShowChoiceViewModel(show.Id, show.Title));
        }

        OnPropertyChanged(nameof(HasShows));

#pragma warning disable MVVMTK0034
        // Straight to the field: choosing through the property would read the episodes twice.
        _show = Shows[0];
#pragma warning restore MVVMTK0034
        OnPropertyChanged(nameof(Show));
    }

    private async Task<bool> ReadEpisodesAsync(CancellationToken cancellationToken)
    {
        var id = Show?.Id;
        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Podcasts.ListEpisodesAsync(new StationEpisodeQuery { ShowId = id }, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return false;
        }

        PresentEpisodes(page);
        return true;
    }

    /// <summary>Draws the episodes the station answered with. Public so a frame can be posed from them.</summary>
    public void PresentEpisodes(StationEpisodePage page)
    {
        ArgumentNullException.ThrowIfNull(page);

        var now = _time.GetUtcNow();
        Episodes.Clear();
        foreach (var episode in page.Episodes)
        {
            Episodes.Add(new EpisodeRowViewModel(episode, now));
        }

        Empty = Shows.Count <= 1
            ? "The station carries no shows yet. Look one up below and subscribe, or add a feed address on the Podcasts plugin's settings. A show's episodes arrive here once its feed has been read."
            : Episodes.Count == 0
                ? "The station has read no episodes yet. The feeds are read every half hour; read them now to see what they carry."
                : null;
    }

    [RelayCommand]
    private async Task ReadFeedsAsync()
    {
        if (await Actions.DoAsync(async token =>
            {
                using var sdk = Sdk();
                await sdk.Podcasts.RefreshPodcastsAsync(token).ConfigureAwait(false);
            }).ConfigureAwait(true))
        {
            Notice = "The station is reading every feed again. New episodes appear here in a minute or two.";
        }
    }

    /// <summary>Asks for an episode's audio now rather than a few hours before its band.</summary>
    [RelayCommand]
    private async Task FetchAsync(EpisodeRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var episode = await Actions.RunAsync(async token =>
        {
            using var sdk = Sdk();
            return await sdk.Podcasts.FetchEpisodeAsync(row.Id, token).ConfigureAwait(false);
        }).ConfigureAwait(true);

        if (episode is null)
        {
            return;
        }

        var index = Episodes.IndexOf(row);
        if (index >= 0)
        {
            Episodes[index] = new EpisodeRowViewModel(episode, _time.GetUtcNow());
        }

        Notice = $"Fetching {row.Title}. It is ready to air once it arrives.";
    }

    [RelayCommand]
    private async Task SearchAsync(CancellationToken cancellationToken)
    {
        var words = Query.Trim();
        if (words.Length == 0)
        {
            return;
        }

        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Podcasts.SearchPodcastDirectoryAsync(
                    new StationDirectoryQuery { Query = words, Limit = DirectoryResults },
                    token).ConfigureAwait(false);
            },
            new Dictionary<int, string>
            {
                [403] = "Searching the directory is for somebody who manages the station, since the words go to somebody else's directory.",
            },
            cancellationToken).ConfigureAwait(true);

        if (page is not null)
        {
            PresentResults(page);
        }
    }

    /// <summary>Draws what the directory found. Public so a frame can be posed from it.</summary>
    public void PresentResults(StationDirectoryPage page)
    {
        ArgumentNullException.ThrowIfNull(page);

        Results.Clear();
        foreach (var entry in page.Results)
        {
            Results.Add(new DirectoryRowViewModel(entry, _carried.Contains(entry.FeedUrl)));
        }

        NoResults = Results.Count == 0 ? "Nothing in the directory matches that. A show's exact name usually finds it." : null;
    }

    /// <summary>Adds the show to the podcast plugin's feeds, then asks for the feeds to be read.</summary>
    [RelayCommand]
    private async Task SubscribeAsync(DirectoryRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);
        var entry = row.Entry;

        var plugin = await Actions.RunAsync(async token =>
        {
            using var sdk = Sdk();
            return await sdk.Plugins.GetPluginAsync(entry.PluginId, token).ConfigureAwait(false);
        }).ConfigureAwait(true);

        if (plugin is null)
        {
            return;
        }

        var subscription = PodcastRules.With(plugin.ConfigFields, plugin.Config, entry.Title, entry.FeedUrl);
        if (subscription is null)
        {
            Notice = $"{plugin.Name} keeps no list of feeds this app can add to.";
            return;
        }

        if (subscription.Unreadable)
        {
            Notice = $"{plugin.Name}'s list of feeds could not be read, so nothing was changed. Its settings page shows what is there.";
            return;
        }

        var saved = await Actions.RunAsync(async token =>
        {
            using var sdk = Sdk();
            return await sdk.Plugins.UpdatePluginConfigurationAsync(
                entry.PluginId,
                new PluginConfigInput
                {
                    Config = new Dictionary<string, JsonElement>(StringComparer.Ordinal)
                    {
                        [subscription.FieldKey] = JsonSerializer.SerializeToElement(subscription.Value),
                    },
                },
                token).ConfigureAwait(false);
        }).ConfigureAwait(true);

        if (saved is null)
        {
            return;
        }

        _carried.Add(entry.FeedUrl);
        row.Subscribed = true;

        await Actions.DoAsync(async token =>
        {
            using var sdk = Sdk();
            await sdk.Podcasts.RefreshPodcastsAsync(token).ConfigureAwait(false);
        }).ConfigureAwait(true);

        Notice = $"Subscribed to {entry.Title}. Its episodes appear here once its feed has been read.";
    }

    public override void Reset()
    {
        base.Reset();
        _carried.Clear();
        Shows.Clear();
        Episodes.Clear();
        Results.Clear();
        Empty = null;
        NoResults = null;
        Query = string.Empty;
        OnPropertyChanged(nameof(HasShows));
    }
}
