using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What the slot editor may send, and how a stored slot reads back into it.
/// </summary>
/// <remarks>
/// <c>PUT</c> replaces a slot, so a field the editor forgets is a field cleared; an end of midnight that
/// round-trips as 00:00 is a late show that appears to end before it starts; and an unticked box that
/// sent <c>false</c> would override a station-wide setting nobody chose to override.
/// </remarks>
public class SlotDraftTests
{
    private static readonly SlotDraft Valid = new() { Label = "Breakfast", StartsAt = "06:00", EndsAt = "10:00" };

    [Fact]
    public void ASlotNeedsAName() => Assert.Equal("A slot needs a name.", (Valid with { Label = " " }).Problem());

    [Theory]
    [InlineData("6am", "10:00")]
    [InlineData("06:00", "25:00")]
    [InlineData("24:00", "10:00")]
    public void BothEndsHaveToBeTimes(string starts, string ends) =>
        Assert.NotNull((Valid with { StartsAt = starts, EndsAt = ends }).Problem());

    [Theory]
    [InlineData("22:00", "02:00")]
    [InlineData("06:00", "06:00")]
    [InlineData("22:00", "24:00")]
    public void AnEndBeforeTheStartOrEqualToItIsNotAMistake(string starts, string ends) =>
        Assert.Null((Valid with { StartsAt = starts, EndsAt = ends }).Problem());

    [Theory]
    [InlineData("1899")]
    [InlineData("2101")]
    [InlineData("seventies")]
    public void APeriodIsAYearTheStationTakes(string year) =>
        Assert.NotNull((Valid with { EraFrom = year }).Problem());

    [Fact]
    public void ABriefIsAtMostFiveHundredCharacters() =>
        Assert.NotNull((Valid with { Brief = new string('a', 501) }).Problem());

    [Fact]
    public void TwentyFourHundredIsSentAsZero()
    {
        var input = (Valid with { StartsAt = "22:00", EndsAt = "24:00" }).ToInput()!;

        Assert.Equal(1320, input.StartsAtMinutes);
        Assert.Equal(0, input.EndsAtMinutes);
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(1440L)]
    public void AStoredEndOfMidnightOpensAsTwentyFourHundred(long end) =>
        Assert.Equal("24:00", SlotDraft.From(Slot(end: end)).EndsAt);

    [Fact]
    public void TheDaysAreSentInOrder_AndNoneIsEveryDay()
    {
        Assert.Equal([1L, 3L, 5L], (Valid with { Days = new HashSet<int> { 5, 1, 3 } }).ToInput()!.Days);
        Assert.Empty(Valid.ToInput()!.Days!);
    }

    [Fact]
    public void AnUntickedBoxSendsNothing_NotFalse()
    {
        var input = (Valid with { Callins = false, MixInSimilar = false }).ToInput()!;

        Assert.Null(input.Callins);
        Assert.Null(input.MixInSimilar);
    }

    [Fact]
    public void MixingInIsSentOnlyBesideAPlaylist()
    {
        Assert.Null((Valid with { MixInSimilar = true, Source = new ProgrammeSource.Chart("lastfm:top") }).ToInput()!.MixInSimilar);
        Assert.True((Valid with { MixInSimilar = true, Source = new ProgrammeSource.Playlist("spotify", "dw") }).ToInput()!.MixInSimilar);
        Assert.True((Valid with { MixInSimilar = true, Source = new ProgrammeSource.Station(Guid.NewGuid()) }).ToInput()!.MixInSimilar);
    }

    [Fact]
    public void OneSourceIsSent_AndTheChartOrderOnlyWithAChart()
    {
        var chart = (Valid with { Source = new ProgrammeSource.Chart("lastfm:top"), ChartOrder = ScheduleSlotSourceChartOrder.Ranked }).ToInput()!;
        var playlist = (Valid with { Source = new ProgrammeSource.Playlist("spotify", "dw"), ChartOrder = ScheduleSlotSourceChartOrder.Ranked }).ToInput()!;

        Assert.Equal(("lastfm:top", ScheduleSlotSourceChartOrder.Ranked), (chart.SourceChartId, chart.SourceChartOrder));
        Assert.Null(chart.SourcePluginId);
        Assert.Equal(("spotify", "dw"), (playlist.SourcePluginId, playlist.SourcePlaylistId));
        Assert.Null(playlist.SourceChartOrder);
        Assert.Null(playlist.SourceChartId);
    }

    [Fact]
    public void EmptyBoxesAreAbsent_NotEmpty()
    {
        var input = (Valid with { Brief = "  ", PersonaId = string.Empty }).ToInput()!;

        Assert.Null(input.Brief);
        Assert.Null(input.PersonaId);
        Assert.Null(input.EraFrom);
    }

    [Fact]
    public void AStoredSlotRoundTripsThroughTheEditor()
    {
        var stored = Slot() with
        {
            Days = [1, 2],
            SourceStationPlaylistId = Guid.Parse("7d8f2a3e-0000-4000-8000-000000000001"),
            PersonaId = "p1",
            Brief = "Bright.",
            EraFrom = 1970,
            Callins = true,
            Mode = ScheduleSlotMode.Setlist,
            OnEnd = ScheduleSlotOnEnd.Repeat,
        };

        var input = SlotDraft.From(stored).ToInput()!;

        Assert.Equal(stored.Label, input.Label);
        Assert.Equal((stored.StartsAtMinutes, stored.EndsAtMinutes), (input.StartsAtMinutes, input.EndsAtMinutes));
        Assert.Equal(stored.Days, input.Days);
        Assert.Equal(stored.SourceStationPlaylistId, input.SourceStationPlaylistId);
        Assert.Equal((stored.PersonaId, stored.Brief, stored.EraFrom), (input.PersonaId, input.Brief, input.EraFrom));
        Assert.Equal((stored.Callins, stored.Mode, stored.OnEnd), (input.Callins, input.Mode, input.OnEnd));
    }

    [Theory]
    [InlineData("06:00", "10:00", "Runs 4 h.")]
    [InlineData("23:00", "02:00", "Runs past midnight: 3 h.")]
    [InlineData("22:00", "24:00", "Runs 2 h.")]
    [InlineData("06:00", "06:00", "The same time at both ends is the whole day.")]
    public void TheTimesAreSaidInWords(string starts, string ends, string expected) =>
        Assert.Equal(expected, (Valid with { StartsAt = starts, EndsAt = ends }).Reading());

    [Theory]
    [InlineData(360L, 600L, "06:00–10:00")]
    [InlineData(1380L, 0L, "23:00–24:00")]
    [InlineData(1260L, 120L, "21:00–02:00")]
    [InlineData(360L, 360L, "06:00, all day")]
    public void ASlotsHoursReadInTheList(long start, long end, string expected) => Assert.Equal(expected, SlotText.Window(start, end));

    [Fact]
    public void ASpecialsDatesAndItsMoodStagesSurviveASave_ThoughTheEditorDrawsNeither()
    {
        var special = Slot() with
        {
            StartsOn = "2026-10-31",
            EndsOn = "2026-10-31",
            Yearly = true,
            Moods = [ScheduleSlotMoods.Comfort, ScheduleSlotMoods.Fear],
            GuestHosts = [new SlotGuestHost { PersonaId = "rockzo", EveryN = 7 }],
            CoHosts = [new SlotCoHost { PersonaId = "lemmy", EveryN = 25, CooldownDays = 14 }],
        };

        var input = SlotDraft.From(special).ToInput()!;

        Assert.Equal("2026-10-31", input.StartsOn);
        Assert.Equal("2026-10-31", input.EndsOn);
        Assert.True(input.Yearly);
        Assert.Equal([ScheduleSlotMoods.Comfort, ScheduleSlotMoods.Fear], input.Moods);
        Assert.Equal("rockzo", Assert.Single(input.GuestHosts!).PersonaId);
        Assert.Equal("lemmy", Assert.Single(input.CoHosts!).PersonaId);
    }

    [Fact]
    public void AWeeklySlotSendsNoDates()
    {
        var input = SlotDraft.From(Slot()).ToInput()!;

        Assert.Null(input.StartsOn);
        Assert.Null(input.EndsOn);
    }

    [Fact]
    public void ASpecialReadsAsItsDatesRatherThanItsDays()
    {
        Assert.Equal("Every day", SlotText.When(Slot()));
        Assert.Equal("Special: 2026-12-24 to 2026-12-26", SlotText.When(Slot() with { StartsOn = "2026-12-24", EndsOn = "2026-12-26" }));
        Assert.Equal("Special, every year: 10-31", SlotText.When(Slot() with { StartsOn = "2020-10-31", EndsOn = "2020-10-31", Yearly = true }));
    }

    [Fact]
    public void NoDaysOrAllSevenIsEveryDay()
    {
        Assert.Equal("Every day", SlotText.Days(null));
        Assert.Equal("Every day", SlotText.Days([0, 1, 2, 3, 4, 5, 6]));
        Assert.Equal("Sun, Sat", SlotText.Days([6, 0]));
    }

    private static ScheduleSlot Slot(long start = 360, long end = 600) => new()
    {
        Id = "s",
        Label = "Breakfast",
        StartsAtMinutes = start,
        EndsAtMinutes = end,
        Mode = ScheduleSlotMode.Rotation,
        OnEnd = ScheduleSlotOnEnd.Extend,
    };
}
