using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One story the station could talk about.</summary>
/// <param name="Tags">The feed's name, what the operator filed the feed under, and what the publisher said the story was about.</param>
public sealed record StoryRowViewModel(string Feed, string Title, string When, string? Summary = null, Uri? Url = null, string? Tags = null)
{
    public bool HasSummary => Summary is not null;

    public bool HasUrl => Url is not null;
}

/// <summary>A feed in the list beside the stories, which narrows them to that feed.</summary>
/// <param name="Id">Null for every feed at once.</param>
public sealed record FeedRowViewModel(string? Id, string Name, string? Line)
{
    public bool HasLine => Line is not null;

    public override string ToString() => Name;
}

/// <summary>
/// The feeds the station reads, and the stories they have brought in.
/// </summary>
/// <remarks>
/// <para>
/// The feeds are listed beside the stories and choosing one narrows them to it, which is a read of
/// that feed rather than a filter over the last answer: a feed quiet enough to have nothing among
/// every feed's newest stories would otherwise look empty. A category is what the operator filed a feed under and
/// travels with the feed, not the story, so it filters what is already here.
/// </para>
/// <para>
/// Headlines only, as the web console asks: the story behind each one is read from the publisher's
/// own page, which is the slowest thing the route does, and nothing here shows it.
/// </para>
/// </remarks>
public sealed partial class NewsViewModel(OperatorActions actions, HttpClient http) : LibraryTabViewModel(actions, http)
{
    private const string Every = "Every category";

    private List<NewsStory> _stories = [];
    private Dictionary<string, string> _categoryOf = new(StringComparer.Ordinal);

    public ObservableCollection<FeedRowViewModel> Feeds { get; } = [];

    public ObservableCollection<StoryRowViewModel> Stories { get; } = [];

    public ObservableCollection<string> Categories { get; } = [];

    [ObservableProperty]
    private FeedRowViewModel? _feed;

    [ObservableProperty]
    private string? _category;

    [ObservableProperty]
    private string? _empty;

    /// <summary>A category choice with one entry cannot narrow anything, so it is only drawn when there are some.</summary>
    public bool HasCategories => Categories.Count > 1;

    partial void OnFeedChanged(FeedRowViewModel? value)
    {
        if (value is not null && Feeds.Count > 0)
        {
            _ = ReadStoriesAsync(CancellationToken.None);
        }
    }

    partial void OnCategoryChanged(string? value) => Show();

    protected override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        var feeds = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.News.ListFeedsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (feeds is null)
        {
            return false;
        }

        PresentFeeds(feeds);
        return await ReadStoriesAsync(cancellationToken).ConfigureAwait(true);
    }

    /// <summary>Draws the feeds the station answered with. Public so a frame can be posed from them.</summary>
    public void PresentFeeds(StationFeedList feeds)
    {
        ArgumentNullException.ThrowIfNull(feeds);

        _categoryOf = feeds.Feeds
            .Where(feed => feed.Category is not null)
            .ToDictionary(feed => feed.Id, feed => feed.Category!, StringComparer.Ordinal);

        Feeds.Clear();
        Feeds.Add(new FeedRowViewModel(null, "Every feed", feeds.Feeds.Count == 1 ? "1 feed" : $"{feeds.Feeds.Count} feeds"));
        foreach (var feed in feeds.Feeds)
        {
            var line = string.Join(" · ", new[] { feed.Category, feed.Language?.ToUpperInvariant() }.OfType<string>());
            Feeds.Add(new FeedRowViewModel(feed.Id, feed.Name, line.Length == 0 ? null : line));
        }

        Categories.Clear();
        Categories.Add(Every);
        foreach (var category in _categoryOf.Values.Distinct(StringComparer.Ordinal).Order(StringComparer.CurrentCulture))
        {
            Categories.Add(category);
        }

        OnPropertyChanged(nameof(HasCategories));

#pragma warning disable MVVMTK0034
        // Straight to the fields: choosing through the properties would read the stories twice.
        _feed = Feeds[0];
        _category = Every;
#pragma warning restore MVVMTK0034
        OnPropertyChanged(nameof(Feed));
        OnPropertyChanged(nameof(Category));
    }

    private async Task<bool> ReadStoriesAsync(CancellationToken cancellationToken)
    {
        var id = Feed?.Id;
        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.News.ReadNewsAsync(new NewsQuery { FeedId = id, HeadlinesOnly = true }, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return false;
        }

        PresentStories(page);
        return true;
    }

    /// <summary>Draws the stories the station answered with. Public so a frame can be posed from them.</summary>
    public void PresentStories(NewsPage page)
    {
        ArgumentNullException.ThrowIfNull(page);
        _stories = [.. page.Stories];
        Show();
    }

    private void Show()
    {
        var category = Category is null or Every ? null : Category;

        Stories.Clear();
        foreach (var story in _stories.Where(story => category is null || _categoryOf.GetValueOrDefault(story.FeedId) == category))
        {
            Stories.Add(Row(story, _categoryOf.GetValueOrDefault(story.FeedId)));
        }

        var narrowed = category is not null || Feed?.Id is not null;
        Empty = Feeds.Count <= 1
            ? "No plugin offers a feed. News arrives with a plugin that reads one: enable one that declares the news capability and add a feed to its settings."
            : Stories.Count > 0
                ? null
                : narrowed
                    ? "Nothing matches that. A category claims the stories of the feeds it was given, so a category with no feed under it has nothing to show."
                    : "The feeds answered with no stories. That is an ordinary state for a slow newsroom rather than a fault.";
    }

    /// <summary>One story as a row. The time is parsed where it parses and shown as sent where it does not.</summary>
    public static StoryRowViewModel Row(NewsStory story, string? category)
    {
        ArgumentNullException.ThrowIfNull(story);

        var tags = new List<string>();
        if (category is not null)
        {
            tags.Add(category);
        }

        tags.AddRange(story.Categories ?? []);

        return new StoryRowViewModel(
            story.FeedName,
            story.Title,
            When(story.PublishedAt),
            string.IsNullOrWhiteSpace(story.Summary) ? null : story.Summary,
            Uri.TryCreate(story.Url, UriKind.Absolute, out var url) && url.Scheme is "http" or "https" ? url : null,
            tags.Count == 0 ? null : string.Join(" · ", tags));
    }

    /// <summary>
    /// `publishedAt` is a STRING rather than a datetime, because a feed publishes whatever precision
    /// it has. Parsed where it parses and shown as sent where it does not, rather than invented.
    /// </summary>
    public static string When(string? published) =>
        DateTimeOffset.TryParse(published, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed.ToLocalTime().ToString("dd MMM HH:mm", CultureInfo.InvariantCulture)
            : published ?? string.Empty;

    public override void Reset()
    {
        base.Reset();
        _stories = [];
        _categoryOf = new(StringComparer.Ordinal);
        Feeds.Clear();
        Stories.Clear();
        Categories.Clear();
        Empty = null;
        OnPropertyChanged(nameof(HasCategories));
    }
}
