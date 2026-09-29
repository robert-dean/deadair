using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Programme;

/// <summary>One cell of the on-now strip.</summary>
/// <param name="Eyebrow">What the cell is: On air, Due now, Up next, After that, Between blocks.</param>
/// <param name="Aside">How long is left, or how long until it starts.</param>
/// <param name="Name">The block's name, or "Nothing scheduled" between blocks.</param>
/// <param name="When">Its weekday and hours, with the host after them when there is one.</param>
/// <param name="Brief">What it is asked to play, when the stored slot says.</param>
/// <param name="Progress">How far through, 0 to 1, for the block on now and nothing else.</param>
/// <param name="Note">A sentence under the cell: why the station is airing something else, or what a gap plays.</param>
/// <param name="SlotId">The stored slot the block came from, which is what an edit opens.</param>
public sealed record OnNowCell(
    string Eyebrow,
    string Aside,
    string Name,
    string When,
    string? Brief,
    double? Progress,
    string? Note,
    string? SlotId)
{
    public bool HasProgress => Progress is not null;

    /// <summary>The progress as a bar takes it, which has no "none".</summary>
    public double ProgressValue => Progress ?? 0;

    public bool HasBrief => !string.IsNullOrWhiteSpace(Brief);

    public bool HasNote => Note is not null;
}

/// <summary>
/// What is on, what is next and what is after that, from one reading of the station's clock.
/// </summary>
/// <remarks>
/// <para>
/// Every fact comes from <c>GET /schedule/current</c>: the blocks and <c>now</c> are read in one frame
/// by the station, so what is left is one subtraction between two readings rather than anything
/// derived from this machine's clock. There is no ticking here; the strip moves when the page is
/// fetched, and a countdown between fetches would be a second clock nobody asked about.
/// </para>
/// <para>
/// <b>The block on now is not always the one airing.</b> An operator's own choice holds until the
/// next block begins, so the schedule can want something the station is not doing. That is said on
/// the block it is about, as Due now, rather than badging it On air while something else plays.
/// </para>
/// </remarks>
public static class OnNow
{
    public static IReadOnlyList<OnNowCell> Cells(
        ScheduleNow current,
        IReadOnlyList<ScheduleSlot> slots,
        IReadOnlyList<Persona> personas)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(slots);
        ArgumentNullException.ThrowIfNull(personas);

        var blocks = current.Upcoming;

        // Covering `now` is what makes the first block the one ON now rather than the next one. Both
        // stamps are fixed-width readings of one clock, so comparing them as text is the whole test.
        var live = blocks.Count > 0 && string.CompareOrdinal(blocks[0].Start, current.Now) <= 0 ? blocks[0] : null;
        var ahead = blocks.Skip(live is null ? 0 : 1).Take(2).ToList();

        // Absent counts, and is the commonest form of it: a station put on by hand before there was
        // a schedule belongs to no slot at all.
        var takenOver = current.SlotId is not null && current.SlotId != current.AiringSlotId;

        var cells = new List<OnNowCell>(3);
        if (live is null)
        {
            cells.Add(new OnNowCell(
                "Between blocks",
                string.Empty,
                "Nothing scheduled",
                string.Empty,
                null,
                null,
                blocks.Count == 0
                    ? "No block is due from here on, so the station stays on whatever it is set to sustain on."
                    : $"The station is on its sustaining source for the next {StationTime.Span(StationTime.MinutesBetween(current.Now, blocks[0].Start))}.",
                null));
        }
        else
        {
            var total = StationTime.MinutesBetween(live.Start, live.End);
            var gone = StationTime.MinutesBetween(live.Start, current.Now);
            var slot = SlotOf(slots, live);

            cells.Add(new OnNowCell(
                takenOver ? "Due now" : "On air",
                $"{StationTime.Span(total - gone)} left",
                Name(live),
                When(live, slot, personas),
                slot?.Brief,
                total <= 0 ? 0 : Math.Clamp(gone / (double)total, 0, 1),
                takenOver
                    ? "The station is airing something else, which is what happens when it was put on by hand. It moves back to the schedule when the next block begins."
                    : null,
                slot?.Id));
        }

        for (var index = 0; index < ahead.Count; index++)
        {
            var block = ahead[index];
            var slot = SlotOf(slots, block);
            cells.Add(new OnNowCell(
                index == 0 ? "Up next" : "After that",
                $"in {StationTime.Span(StationTime.MinutesBetween(current.Now, block.Start))}",
                Name(block),
                When(block, slot, personas),
                slot?.Brief,
                null,
                null,
                slot?.Id));
        }

        return cells;
    }

    private static string Name(ScheduleOccurrence block) => string.IsNullOrWhiteSpace(block.Label) ? "Untitled" : block.Label;

    /// <summary>The hours, and who hosts it: the persona is on the stored slot, never on the block.</summary>
    private static string When(ScheduleOccurrence block, ScheduleSlot? slot, IReadOnlyList<Persona> personas)
    {
        var when = StationTime.When(block.Start, block.End);
        var host = slot?.PersonaId is { } id ? personas.FirstOrDefault(persona => persona.Id == id) : null;
        return host is null ? when : $"{when} · {host.Label}";
    }

    /// <summary>
    /// The stored slot a drawn block came from. The schedule and the strip are two reads, so for a
    /// moment after a delete the strip can name a block the list no longer has.
    /// </summary>
    private static ScheduleSlot? SlotOf(IReadOnlyList<ScheduleSlot> slots, ScheduleOccurrence block) =>
        slots.FirstOrDefault(slot => slot.Id == block.SlotId);
}
