using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Where an episode is, and how subscribing writes the podcast plugin's feed list.
/// </summary>
/// <remarks>
/// Subscribing writes somebody's configuration, so it must keep every row that was there exactly as
/// it was: a save that dropped a row's id, or read an unreadable list as empty and wrote one row back,
/// would delete subscriptions nobody asked to lose.
/// </remarks>
public class PodcastRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    private static StationEpisode Episode() => new()
    {
        Id = "e",
        ShowId = "s",
        EpisodeId = "x",
        ShowTitle = "Show",
        Title = "t",
        SeenAt = "2026-09-28T00:00:00Z",
        Fetched = false,
    };

    private static readonly List<ConfigFieldDescriptor> Fields =
    [
        new() { Key = "directory", Label = "Directory", Type = ConfigFieldType.String },
        new()
        {
            Key = "feeds",
            Label = "Feeds",
            Type = ConfigFieldType.List,
            Columns =
            [
                new() { Key = "name", Label = "Name", Type = ConfigFieldColumnType.String },
                new() { Key = "url", Label = "Address", Type = ConfigFieldColumnType.Url },
            ],
        },
    ];

    [Fact]
    public void AnAiredEpisodeIsAiredWhateverElseIsTrue() =>
        Assert.Equal(EpisodeState.Aired, PodcastRules.State(Episode() with { AiredAt = "2026-09-28T21:00:00Z", Fetched = true }, Now));

    [Fact]
    public void AFetchAskedForRecentlyIsFetchingEvenAfterAFailure() =>
        Assert.Equal(EpisodeState.Fetching, PodcastRules.State(Episode() with { FetchRequestedAt = "2026-09-29T11:55:00Z", FetchError = "404" }, Now));

    [Fact]
    public void AFetchAskedForLongAgoIsNoLongerDrawnAsFetching() =>
        Assert.Equal(EpisodeState.Failed, PodcastRules.State(Episode() with { FetchRequestedAt = "2026-09-29T10:00:00Z", FetchError = "404" }, Now));

    [Fact]
    public void OnlyAnEpisodeNeitherHereNorOnItsWayCanBeFetched()
    {
        Assert.True(PodcastRules.CanFetch(EpisodeState.Unfetched));
        Assert.True(PodcastRules.CanFetch(EpisodeState.Failed));
        Assert.False(PodcastRules.CanFetch(EpisodeState.Fetching));
        Assert.False(PodcastRules.CanFetch(EpisodeState.Ready));
    }

    [Fact]
    public void SubscribingAddsARowAndKeepsEveryRowThereExactly()
    {
        var existing = """[{"$id":"a1","name":"History","url":"https://h.example/feed","extra":true}]""";
        var config = new Dictionary<string, JsonElement> { ["feeds"] = JsonSerializer.SerializeToElement(existing) };

        var subscription = PodcastRules.With(Fields, config, "Song Exploder", "https://s.example/feed");

        Assert.NotNull(subscription);
        Assert.Equal("feeds", subscription.FieldKey);
        var rows = JsonDocument.Parse(subscription.Value).RootElement;
        Assert.Equal(2, rows.GetArrayLength());
        Assert.Equal("a1", rows[0].GetProperty("$id").GetString());
        Assert.True(rows[0].GetProperty("extra").GetBoolean());
        Assert.Equal("Song Exploder", rows[1].GetProperty("name").GetString());
    }

    [Fact]
    public void AShowAlreadyThereIsNotAddedTwice()
    {
        var config = new Dictionary<string, JsonElement>
        {
            ["feeds"] = JsonSerializer.SerializeToElement("""[{"name":"S","url":"https://s.example/feed"}]"""),
        };

        var subscription = PodcastRules.With(Fields, config, "S", "https://s.example/feed");

        Assert.True(subscription!.AlreadyThere);
        Assert.Equal(1, JsonDocument.Parse(subscription.Value).RootElement.GetArrayLength());
    }

    [Fact]
    public void AListStoredAsAnArrayIsReadRatherThanOverwritten()
    {
        var config = new Dictionary<string, JsonElement>
        {
            ["feeds"] = JsonDocument.Parse("""[{"name":"H","url":"https://h.example/feed"}]""").RootElement,
        };

        var subscription = PodcastRules.With(Fields, config, "S", "https://s.example/feed");

        Assert.Equal(2, JsonDocument.Parse(subscription!.Value).RootElement.GetArrayLength());
    }

    [Fact]
    public void AnUnreadableListIsRefusedRatherThanReplaced()
    {
        var config = new Dictionary<string, JsonElement> { ["feeds"] = JsonSerializer.SerializeToElement("[{ broken") };

        Assert.True(PodcastRules.With(Fields, config, "S", "https://s.example/feed")!.Unreadable);
    }

    [Fact]
    public void APluginWithNoListOfAddressesCannotBeSubscribedThrough() =>
        Assert.Null(PodcastRules.With([Fields[0]], new Dictionary<string, JsonElement>(), "S", "https://s.example/feed"));
}
