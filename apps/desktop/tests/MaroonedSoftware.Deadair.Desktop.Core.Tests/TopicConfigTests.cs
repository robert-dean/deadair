using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A subject's configuration between what the station stores and what the form draws.
/// </summary>
/// <remarks>
/// A save REPLACES a subject's configuration, and the form reports only what changed. Sending only the
/// changes would wipe every field nobody touched, so the stored configuration has to go back with the
/// changes laid over it, in the shape it was stored in.
/// </remarks>
public class TopicConfigTests
{
    private static readonly string[] Words = ["football", "league"];

    private static TopicKindDescriptor Kind(string placeholder) => new()
    {
        Kind = "news",
        NounOne = "category",
        NounMany = "categories",
        Description = "d",
        Fields =
        [
            new() { Key = "keywords", Label = "Words", Type = ConfigFieldType.Text, Placeholder = placeholder },
            new() { Key = "place", Label = "Place", Type = ConfigFieldType.String },
        ],
    };

    private static Topic Topic() => new()
    {
        Id = "t",
        Kind = "news",
        Key = "football",
        Label = "Football",
        Position = 0,
        Config = new Dictionary<string, JsonElement>
        {
            ["keywords"] = JsonSerializer.SerializeToElement(Words),
            ["place"] = JsonSerializer.SerializeToElement("Leeds"),
        },
    };

    [Fact]
    public void AStoredListIsDrawnOnePerLineWhenItsPlaceholderIsWrittenThatWay()
    {
        Assert.Equal("football\nleague", TopicConfig.Stored(Kind("a\nb"), Topic())["keywords"].GetString());
        Assert.Equal("football, league", TopicConfig.Stored(Kind("a, b"), Topic())["keywords"].GetString());
    }

    [Fact]
    public void AFieldNobodyTouchedGoesBackAsItWasStored()
    {
        var merged = TopicConfig.Merge(Topic(), new Dictionary<string, JsonElement> { ["place"] = JsonSerializer.SerializeToElement("York") });

        Assert.Equal(JsonValueKind.Array, merged["keywords"].ValueKind);
        Assert.Equal("York", merged["place"].GetString());
    }

    [Fact]
    public void ASubjectSaysHowManyEntriesEachFieldHolds_OrThatItMatchesNothing()
    {
        Assert.Equal("Words: 2 · Place: 1", TopicConfig.Summary(Topic(), Kind(string.Empty)));
        Assert.Equal("nothing to match yet", TopicConfig.Summary(Topic() with { Config = [] }, Kind(string.Empty)));
    }
}
