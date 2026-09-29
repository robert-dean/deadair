using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The format clock's bands: what the editor may send, how a reorder is written, and what the dial draws.
/// </summary>
/// <remarks>
/// <c>PUT</c> replaces a band, so a write that forgot a field clears it; a draft that sent both halves
/// of a shape is a band the station reads one way and the editor another; and a dial that drew a
/// spacing rule at an angle would be inventing a time the rule does not have.
/// </remarks>
public class FormatClockTests
{
    [Fact]
    public void ABandNeedsASortOfBreak() =>
        Assert.Equal("A band needs a sort of break.", new BandDraft { Kind = "  " }.Problem());

    [Theory]
    [InlineData("-1")]
    [InlineData("60")]
    [InlineData("half")]
    public void AnHourlyBandIsZeroToFiftyNineMinutesPast(string minute) =>
        Assert.NotNull(new BandDraft { Kind = "news", Minute = minute }.Problem());

    [Theory]
    [InlineData("1", true)]
    [InlineData("720", true)]
    [InlineData("0", false)]
    [InlineData("721", false)]
    public void AnIntervalIsOneToSevenHundredTwentyMinutes(string every, bool sendable) =>
        Assert.Equal(sendable, new BandDraft { Kind = "talk", When = BandWhen.Interval, EveryMinutes = every }.Problem() is null);

    [Fact]
    public void ADailyBandNeedsATime() =>
        Assert.Equal("A time, as 24-hour HH:MM.", new BandDraft { Kind = "news", When = BandWhen.Daily, Time = "7.30" }.Problem());

    [Fact]
    public void AnHourlyBandSendsAMinuteAndNoHour()
    {
        var input = new BandDraft { Kind = " news ", Minute = "30", Position = 4 }.ToInput()!;

        Assert.Equal("news", input.Kind);
        Assert.Equal(ClockBandAt.Clock, input.At);
        Assert.Null(input.Hour);
        Assert.Equal(30, input.Minute);
        Assert.Null(input.EveryMs);
        Assert.Equal(4, input.Position);
    }

    [Fact]
    public void ADailyBandSendsItsHourAndMinute()
    {
        var input = new BandDraft { Kind = "news", When = BandWhen.Daily, Time = "07:45" }.ToInput()!;

        Assert.Equal(7, input.Hour);
        Assert.Equal(45, input.Minute);
    }

    [Fact]
    public void AnIntervalSendsMillisecondsAndNoMinute()
    {
        var input = new BandDraft { Kind = "talk", When = BandWhen.Interval, EveryMinutes = "20" }.ToInput()!;

        Assert.Equal(ClockBandAt.Interval, input.At);
        Assert.Equal(1_200_000, input.EveryMs);
        Assert.Null(input.Minute);
    }

    [Fact]
    public void NoSubjectIsAbsent_NotAnEmptyString() =>
        Assert.Null(new BandDraft { Kind = "news", TopicId = string.Empty }.ToInput()!.TopicId);

    [Fact]
    public void ABandOpensAsTheSentenceItWasWrittenAs()
    {
        var draft = BandDraft.From(Band("x", "news", ClockBandAt.Clock, hour: 9, minute: 5));

        Assert.Equal(BandWhen.Daily, draft.When);
        Assert.Equal("09:05", draft.Time);
        Assert.Equal(draft with { }, BandDraft.From(Band("x", "news", ClockBandAt.Clock, hour: 9, minute: 5)));
    }

    [Fact]
    public void ANewBandGoesAtTheEndOfTheList() =>
        Assert.Equal(8, BandDraft.From(null, FormatClock.NextPosition([Band("a", "news", position: 7), Band("b", "ident", position: 2)])).Position);

    [Theory]
    [InlineData(null, 30L, null, ":30")]
    [InlineData(9L, 0L, null, "09:00")]
    [InlineData(null, null, 1_200_000L, "every 20m")]
    public void ABandSaysWhenItFires(long? hour, long? minute, long? everyMs, string expected) =>
        Assert.Equal(expected, FormatClock.WhenOf(Band("a", "news", everyMs is null ? ClockBandAt.Clock : ClockBandAt.Interval, hour, minute, everyMs)));

    [Fact]
    public void ASwapIsTwoWritesThatTradePositions_AndKeepTheSubject()
    {
        List<ClockBand> bands = [Band("a", "ident", position: 10), Band("b", "news", position: 20, topic: "t1")];

        var writes = FormatClock.Swap(bands, 1, -1);

        Assert.Equal(2, writes.Count);
        Assert.Equal(("b", 10L), (writes[0].Id, writes[0].Body.Position));
        Assert.Equal("t1", writes[0].Body.TopicId);
        Assert.Equal(("a", 20L), (writes[1].Id, writes[1].Body.Position));
    }

    [Fact]
    public void NothingMovesPastTheEndOfTheList()
    {
        List<ClockBand> bands = [Band("a", "ident"), Band("b", "news")];

        Assert.Empty(FormatClock.Swap(bands, 0, -1));
        Assert.Empty(FormatClock.Swap(bands, 1, 1));
    }

    [Fact]
    public void TheGreetingIsNeverOffered() =>
        Assert.Equal(["news", "ident"], FormatClock.Kinds(["news", "welcome", "ident"]));

    [Fact]
    public void ASubjectKeptOffTheAirIsNotOffered()
    {
        List<Topic> topics =
        [
            Topic("t1", "news", offAir: false),
            Topic("t2", "news", offAir: true),
            Topic("t3", "weather", offAir: false),
        ];

        Assert.Equal(["t1"], FormatClock.Subjects(topics, " news ").Select(topic => topic.Id));
    }

    [Fact]
    public void TheDialDrawsOnlyEnabledBandsWithAPlaceOnTheHour()
    {
        List<ClockBand> bands =
        [
            Band("a", "news", minute: 30),
            Band("b", "talk", ClockBandAt.Interval, everyMs: 1_200_000),
            Band("c", "ident", minute: 0, enabled: false),
            Band("d", "sponsor", minute: 20),
        ];

        var marks = FormatClock.Marks(bands, ["news"]);

        Assert.Equal([new DialMark(30, "news :30", false), new DialMark(20, "sponsor :20", true)], marks);
    }

    private static ClockBand Band(
        string id,
        string kind,
        ClockBandAt at = ClockBandAt.Clock,
        long? hour = null,
        long? minute = null,
        long? everyMs = null,
        long position = 0,
        bool enabled = true,
        string? topic = null) => new()
        {
            Id = id,
            Kind = kind,
            At = at,
            Hour = hour,
            Minute = minute,
            EveryMs = everyMs,
            Position = position,
            Enabled = enabled,
            TopicId = topic,
        };

    private static Topic Topic(string id, string kind, bool offAir) => new()
    {
        Id = id,
        Kind = kind,
        Key = id,
        Label = id,
        Position = 0,
        Config = new Dictionary<string, JsonElement> { ["offAir"] = JsonSerializer.SerializeToElement(offAir) },
    };
}
