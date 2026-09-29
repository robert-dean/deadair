using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The on-now strip, from one reading of the station's clock.
/// </summary>
/// <remarks>
/// The block the clock says is on is not always the one airing, and a gap between blocks is an
/// ordinary state. A strip that badged a block On air while the station played something else, or
/// drew a gap as nothing, would be misreporting the station to the one person who can change it.
/// </remarks>
public class OnNowTests
{
    private static readonly ScheduleOccurrence Breakfast = Block("a", "Breakfast", "2026-09-30 06:00:00", "2026-09-30 10:00:00");
    private static readonly ScheduleOccurrence Mornings = Block("b", "Mornings", "2026-09-30 10:00:00", "2026-09-30 13:00:00");
    private static readonly ScheduleOccurrence Lunch = Block("c", "Lunch", "2026-09-30 13:00:00", "2026-09-30 14:00:00");

    [Fact]
    public void TheFirstBlockCoveringNowIsOnAir_WithWhatIsLeftAndHowFarThrough()
    {
        var cells = OnNow.Cells(Now("2026-09-30 09:00:00", "a", "a", Breakfast, Mornings, Lunch), [], []);

        Assert.Equal(3, cells.Count);
        Assert.Equal("On air", cells[0].Eyebrow);
        Assert.Equal("1 h left", cells[0].Aside);
        Assert.Equal(0.75, cells[0].Progress);
        Assert.Equal("Up next", cells[1].Eyebrow);
        Assert.Equal("in 1 h", cells[1].Aside);
        Assert.Equal("After that", cells[2].Eyebrow);
    }

    [Fact]
    public void ABlockTheStationIsNotAiringIsDueNow_AndSaysWhy()
    {
        var cells = OnNow.Cells(Now("2026-09-30 09:00:00", "a", "z", Breakfast, Mornings), [], []);

        Assert.Equal("Due now", cells[0].Eyebrow);
        Assert.NotNull(cells[0].Note);
    }

    [Fact]
    public void AStationPutOnByHandBeforeAnySlotIsNotTakenOver()
    {
        var cells = OnNow.Cells(Now("2026-09-30 09:00:00", null, null), [], []);

        Assert.Equal("Between blocks", cells[0].Eyebrow);
        Assert.Single(cells);
    }

    [Fact]
    public void AGapSaysHowLongTheSustainingSourcePlaysFor()
    {
        var cells = OnNow.Cells(Now("2026-09-30 09:30:00", null, null, Mornings, Lunch), [], []);

        Assert.Equal("Between blocks", cells[0].Eyebrow);
        Assert.Contains("30 min", cells[0].Note, StringComparison.Ordinal);
        Assert.Equal("Up next", cells[1].Eyebrow);
        Assert.Equal("Mornings", cells[1].Name);
    }

    [Fact]
    public void TheHostAndBriefComeFromTheStoredSlot()
    {
        var slot = new ScheduleSlot
        {
            Id = "a",
            Label = "Breakfast",
            StartsAtMinutes = 360,
            EndsAtMinutes = 600,
            PersonaId = "p",
            Brief = "Bright.",
            Mode = ScheduleSlotMode.Rotation,
            OnEnd = ScheduleSlotOnEnd.Extend,
        };
        var host = new Persona { Id = "p", Key = "p", Label = "Marla", Style = string.Empty, DefaultHost = false, Presenting = true };

        var cells = OnNow.Cells(Now("2026-09-30 09:00:00", "a", "a", Breakfast), [slot], [host]);

        Assert.Equal("Wed 06:00–10:00 · Marla", cells[0].When);
        Assert.Equal("Bright.", cells[0].Brief);
        Assert.Equal("a", cells[0].SlotId);
    }

    [Fact]
    public void ABlockTheListNoLongerHasCannotBeEdited() =>
        Assert.Null(OnNow.Cells(Now("2026-09-30 09:00:00", "a", "a", Breakfast), [], [])[0].SlotId);

    private static ScheduleOccurrence Block(string id, string label, string start, string end) =>
        new() { SlotId = id, Label = label, Start = start, End = end };

    private static ScheduleNow Now(string now, string? slot, string? airing, params ScheduleOccurrence[] upcoming) =>
        new() { Now = now, SlotId = slot, AiringSlotId = airing, Upcoming = [.. upcoming] };
}
