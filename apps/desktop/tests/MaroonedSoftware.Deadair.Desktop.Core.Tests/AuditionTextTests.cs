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
    public void AHiddenPlaylistOrOneWhoseTracksCannotBeReadIsNotOffered()
    {
        CatalogPlaylist Playlist(bool? hidden = null, List<PlaylistPermission>? permissions = null) =>
            new() { PluginId = "p", PluginName = "P", Id = "1", Name = "n", Hidden = hidden, Permissions = permissions };

        Assert.True(AuditionText.Offerable(Playlist()));
        Assert.False(AuditionText.Offerable(Playlist(hidden: true)));
        Assert.False(AuditionText.Offerable(Playlist(permissions: [PlaylistPermission.Edit])));
    }
}
