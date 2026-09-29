using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The sustaining source, read from and written to the station's settings.
/// </summary>
/// <remarks>
/// Read in the wrong precedence, the page shows a playlist the station is not sustaining from. Written
/// without clearing the arm not chosen, a stale chart id beside a fresh playlist is a source that wins
/// over it. And a gap with nothing set is a working station, which the sentence must not call a fault.
/// </remarks>
public class SustainingTests
{
    [Fact]
    public void AChartIsReadFirst_AsTheStationReadsIt()
    {
        var values = Values(("schedule.sustainingChartId", "lastfm:top"), ("schedule.sustainingPluginId", "spotify"), ("schedule.sustainingPlaylistId", "dw"));

        Assert.Equal(new ProgrammeSource.Chart("lastfm:top"), Sustaining.Source(values));
    }

    [Fact]
    public void APlaylistNeedsBothHalves()
    {
        Assert.Equal(new ProgrammeSource.Playlist("spotify", "dw"), Sustaining.Source(Values(("schedule.sustainingPluginId", "spotify"), ("schedule.sustainingPlaylistId", "dw"))));
        Assert.Null(Sustaining.Source(Values(("schedule.sustainingPluginId", "spotify"))));
        Assert.Null(Sustaining.Source(Values(("schedule.sustainingChartId", " "))));
    }

    [Fact]
    public void ChoosingAPlaylistClearsTheChart_WithNullRatherThanEmpty()
    {
        var writes = Sustaining.Writes(new ProgrammeSource.Playlist("spotify", "dw"), ScheduleSlotSourceChartOrder.Ranked);

        Assert.Equal("spotify", writes["schedule.sustainingPluginId"].GetString());
        Assert.Equal("dw", writes["schedule.sustainingPlaylistId"].GetString());
        Assert.Equal(JsonValueKind.Null, writes["schedule.sustainingChartId"].ValueKind);
        Assert.Equal(JsonValueKind.Null, writes["schedule.sustainingChartOrder"].ValueKind);
    }

    [Fact]
    public void ChoosingAChartClearsThePlaylist_AndSavesItsOrderAsAWord()
    {
        var writes = Sustaining.Writes(new ProgrammeSource.Chart("lastfm:top"), ScheduleSlotSourceChartOrder.Unordered);

        Assert.Equal("unordered", writes["schedule.sustainingChartOrder"].GetString());
        Assert.Equal(JsonValueKind.Null, writes["schedule.sustainingPluginId"].ValueKind);
    }

    [Fact]
    public void ChoosingNothingClearsAllFour() =>
        Assert.All(Sustaining.Writes(null, ScheduleSlotSourceChartOrder.Countdown).Values, value => Assert.Equal(JsonValueKind.Null, value.ValueKind));

    [Fact]
    public void NothingSetIsSaidAsAWorkingStation() =>
        Assert.Equal(
            "Nothing is set to play between blocks, so a gap keeps whatever the last block left on.",
            Sustaining.Summary(Values(("schedule.sustainingCallins", "true")), [], []));

    [Fact]
    public void TheSentenceNamesWhatPlays_ItsWords_ItsPeriod_AndCalls()
    {
        var values = Values(
            ("schedule.sustainingChartId", "lastfm:top"),
            ("schedule.sustainingBrief", "Quiet."),
            ("schedule.sustainingEraFrom", "1985"),
            ("schedule.sustainingCallins", "true"));

        var summary = Sustaining.Summary(values, [], [new StationChart { Id = "lastfm:top", PluginId = "lastfm", Name = "Top 40" }]);

        Assert.Equal("Between blocks: Top 40, counting down · “Quiet.” · 1985 onwards · taking calls", summary);
    }

    [Fact]
    public void APlaylistTheCatalogCannotNameIsSaidByItsId() =>
        Assert.Equal(
            "Between blocks: dw",
            Sustaining.Summary(Values(("schedule.sustainingPluginId", "spotify"), ("schedule.sustainingPlaylistId", "dw")), [], []));

    [Fact]
    public void APeriodReadsWhicheverEndsItHas()
    {
        Assert.EndsWith("1970–1979", Sustaining.Summary(Values(("schedule.sustainingEraFrom", "1970"), ("schedule.sustainingEraTo", "1979")), [], []), StringComparison.Ordinal);
        Assert.EndsWith("up to 1979", Sustaining.Summary(Values(("schedule.sustainingEraTo", "1979")), [], []), StringComparison.Ordinal);
    }

    private static Dictionary<string, JsonElement> Values(params (string Key, string Value)[] entries) =>
        entries.ToDictionary(entry => entry.Key, entry => JsonSerializer.SerializeToElement(entry.Value));
}
