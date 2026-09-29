using System.Collections.ObjectModel;
using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One story the station could talk about.</summary>
public sealed record StoryRowViewModel(string Feed, string Title, string When);

/// <summary>The stories the station's feeds have brought in.</summary>
public sealed partial class NewsViewModel(OperatorActions actions, HttpClient http) : LibraryTabViewModel(actions, http)
{
    public ObservableCollection<StoryRowViewModel> Stories { get; } = [];

    protected override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.News.ReadNewsAsync(new NewsQuery { Limit = 40 }, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return false;
        }

        Stories.Clear();
        foreach (var story in page.Stories)
        {
            Stories.Add(new StoryRowViewModel(story.FeedName, story.Title, When(story.PublishedAt)));
        }

        return true;
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
        Stories.Clear();
    }
}
