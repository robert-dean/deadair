using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// An audition run: whether it is still worth asking about, and what it came to.
/// </summary>
/// <remarks>
/// The tab polls only while a run can still change, and the station rate-limits, so "unsettled" is
/// the one rule that decides whether a request goes out every few seconds. And the tally is the number
/// the whole feature exists for: how often the model wrote, and how often something covered for it.
/// </remarks>
public class AuditionTextTests
{
    [Theory]
    [InlineData(PersonaAuditionSummaryState.Queued, true)]
    [InlineData(PersonaAuditionSummaryState.Running, true)]
    [InlineData(PersonaAuditionSummaryState.Done, false)]
    [InlineData(PersonaAuditionSummaryState.Failed, false)]
    [InlineData(PersonaAuditionSummaryState.Cancelled, false)]
    public void OnlyARunThatCanStillChangeIsAskedAboutAgain(PersonaAuditionSummaryState state, bool unsettled) =>
        Assert.Equal(unsettled, AuditionText.Unsettled(state));

    [Fact]
    public void EachKindOfSourceSaysWhatItWas()
    {
        Assert.Equal("Late night · deadair.spotify", AuditionText.Describe(new() { PluginId = "deadair.spotify", PlaylistId = "pl1", Name = "Late night" }));
        Assert.Equal(
            "Sunday soul · a station playlist",
            AuditionText.Describe(new() { StationPlaylistId = Guid.Parse("7b0c1a52-9a3e-4f43-8b1e-3d6f0f4a9c11"), Name = "Sunday soul" }));
        Assert.Equal("lastfm:top · a chart", AuditionText.Describe(new() { ChartId = "lastfm:top" }));
    }

    [Fact]
    public void ACancelledRunIsOff_NotAFault()
    {
        Assert.Equal(StatusTone.Off, AuditionText.Tone(PersonaAuditionSummaryState.Cancelled));
        Assert.Equal(StatusTone.Fault, AuditionText.Tone(PersonaAuditionSummaryState.Failed));
    }

    [Fact]
    public void TheTallyCountsWhatTheModelWroteAndWhatItDeclined()
    {
        PersonaAuditionBreak Break(string writer, params string[] outcomes) => new()
        {
            Ordinal = 0,
            Previous = new() { Title = "a", Artist = "b" },
            Next = new() { Title = "c", Artist = "d" },
            Writer = writer,
            Attempts = outcomes.Select(outcome => new PersonaRehearsalAttempt { Writer = writer, Outcome = outcome, DurationMs = 1 }).ToList(),
        };

        Assert.Null(AuditionText.Tally([]));
        Assert.Equal("1 by the model · 1 declined", AuditionText.Tally([Break("model", "declined", "written"), Break("floor", "written")]));
    }

    [Fact]
    public void TheStationsPlaylistsAndTheChartsAreOfferedBesideTheProviders_ButNothingIsNot()
    {
        var owned = Guid.Parse("7b0c1a52-9a3e-4f43-8b1e-3d6f0f4a9c11");
        var sources = AuditionText.Sources(
            [new() { Id = owned.ToString(), Name = "Sunday soul", Prompt = "", TrackCount = 3, ResolvedCount = 3, CreatedAt = DateTimeOffset.UnixEpoch, UpdatedAt = DateTimeOffset.UnixEpoch }],
            [
                new() { PluginId = "p", PluginName = "P", Id = "1", Name = "Late night" },
                new() { PluginId = "p", PluginName = "P", Id = "2", Name = "Hidden", Hidden = true },
                new() { PluginId = "p", PluginName = "P", Id = "3", Name = "Unreadable", Permissions = [PlaylistPermission.Edit] },
            ],
            [new() { Id = "lastfm:top", PluginId = "lastfm", Name = "Top tracks" }],
            chosen: null);

        // An audition with no source has nothing to read, so the timetable's "nothing" is not offered.
        Assert.Equal(["Sunday soul", "Late night", "Top tracks"], sources.Select(choice => choice.Label));
        Assert.Equal(new ProgrammeSource.Station(owned), sources[0].Source);
        Assert.Equal(new ProgrammeSource.Chart("lastfm:top"), sources[2].Source);
    }

    [Fact]
    public void ARequestNamesTheSourcePickedAndNoOther()
    {
        var owned = Guid.Parse("7b0c1a52-9a3e-4f43-8b1e-3d6f0f4a9c11");

        var station = AuditionText.Request(new SourceChoice("Sunday soul", "The station's", new ProgrammeSource.Station(owned)), 10);
        Assert.Equal(owned, station.StationPlaylistId);
        Assert.Null(station.PluginId);
        Assert.Null(station.ChartId);
        // The station reads a playlist of its own's name for itself.
        Assert.Null(station.Name);

        var chart = AuditionText.Request(new SourceChoice("Top tracks", "Chart · lastfm", new ProgrammeSource.Chart("lastfm:top")), 5);
        Assert.Equal("lastfm:top", chart.ChartId);
        Assert.Equal("Top tracks", chart.Name);
        Assert.Null(chart.PlaylistId);
        Assert.Equal(5, chart.Limit);

        var playlist = AuditionText.Request(new SourceChoice("Late night", "P", new ProgrammeSource.Playlist("p", "1")), 10);
        Assert.Equal(("p", "1", "Late night"), (playlist.PluginId, playlist.PlaylistId, playlist.Name));
        Assert.Null(playlist.StationPlaylistId);
    }
}
