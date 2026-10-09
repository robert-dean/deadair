using System.Globalization;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Programme;

/// <summary>
/// A slot as the editor holds it, with the rules for what can be sent.
/// </summary>
/// <remarks>
/// <para>
/// The web console's slot editor, ported. Times are typed as <c>HH:MM</c> and refused rather than
/// coerced; an end BEFORE the start runs the block past midnight, and the same time at both ends is a
/// full day, so neither is an error and there is no "end after start" rule. An end of <c>24:00</c> is
/// accepted and sent as 0, because the station's range stops at 1439 and reads an end at or before
/// the start as wrapping.
/// </para>
/// <para>
/// Overlaps are NOT checked here, as the web console does not check them: the station refuses a block
/// that is on at the same time as another with a 409 and a sentence naming the other one, and that
/// sentence is shown on the dialog. It expands empty days to all seven and a wrapping block's tail
/// onto the next weekday, which a second copy of the rule here would one day disagree with.
/// </para>
/// </remarks>
public sealed record SlotDraft
{
    /// <summary>The ceiling the contract puts on a brief.</summary>
    public const int BriefMax = 500;

    public string Label { get; init; } = string.Empty;

    public string StartsAt { get; init; } = "06:00";

    public string EndsAt { get; init; } = "09:00";

    /// <summary>The weekdays, Sunday 0. Empty is every day, which is the ordinary case.</summary>
    public IReadOnlySet<int> Days { get; init; } = new HashSet<int>();

    public ProgrammeSource? Source { get; init; }

    /// <summary>Which way round a chart is played. Sent only when the source IS a chart.</summary>
    public ScheduleSlotSourceChartOrder ChartOrder { get; init; } = ScheduleSlotSourceChartOrder.Countdown;

    public string? PersonaId { get; init; }

    public string Brief { get; init; } = string.Empty;

    public string EraFrom { get; init; } = string.Empty;

    public string EraTo { get; init; } = string.Empty;

    public bool Callins { get; init; }

    public bool MixInSimilar { get; init; }

    public ScheduleSlotMode Mode { get; init; } = ScheduleSlotMode.Rotation;

    public ScheduleSlotOnEnd OnEnd { get; init; } = ScheduleSlotOnEnd.Extend;

    /// <summary>
    /// What this editor does not draw and must still send back, because <c>PUT</c> replaces the row:
    /// a slot's mood, a special's dates, and its guest hosts and co-hosts. Without them, saving a special here would turn Halloween
    /// into a show every night. Carried exactly as read, and changed only on the web console.
    /// </summary>
    public SlotPassthrough Kept { get; init; } = new();

    /// <summary>
    /// A slot as the editor opens on it, or a new one.
    /// </summary>
    /// <remarks>
    /// A new block starts at six, where a station's day usually does, and is three hours long, because
    /// a block has to have a length and there is no better guess than a plausible one.
    /// </remarks>
    public static SlotDraft From(ScheduleSlot? slot)
    {
        if (slot is null)
        {
            return new SlotDraft();
        }

        return new SlotDraft
        {
            Label = slot.Label,
            StartsAt = StationTime.Clock(slot.StartsAtMinutes),
            EndsAt = StationTime.EndClock(slot.EndsAtMinutes),
            Days = (slot.Days ?? []).Select(day => (int)day).ToHashSet(),
            Source = ProgrammeSource.Of(slot),
            ChartOrder = slot.SourceChartOrder ?? ScheduleSlotSourceChartOrder.Countdown,
            PersonaId = slot.PersonaId,
            Brief = slot.Brief ?? string.Empty,
            EraFrom = slot.EraFrom?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            EraTo = slot.EraTo?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            Callins = slot.Callins == true,
            MixInSimilar = slot.MixInSimilar == true,
            Mode = slot.Mode,
            OnEnd = slot.OnEnd,
            Kept = new SlotPassthrough
            {
                Mood = slot.Mood,
                StartsOn = slot.StartsOn,
                EndsOn = slot.EndsOn,
                Yearly = slot.Yearly,
                GuestHosts = slot.GuestHosts,
                CoHosts = slot.CoHosts,
            },
        };
    }

    /// <summary>The first thing stopping this being sent, in words, or null.</summary>
    public string? Problem()
    {
        // The station permits a nameless slot; the timetable would draw it as "Untitled", which tells
        // an operator nothing about a block they are looking at to decide something. So the editor
        // refuses to make one, as the web console's does.
        if (string.IsNullOrWhiteSpace(Label))
        {
            return "A slot needs a name.";
        }

        if (StationTime.ParseClock(StartsAt) is null)
        {
            return "It starts at a time, as 24-hour HH:MM.";
        }

        if (StationTime.ParseClock(EndsAt, end: true) is null)
        {
            return "It ends at a time, as 24-hour HH:MM.";
        }

        if (Brief.Trim().Length > BriefMax)
        {
            return $"What it is asked to play is at most {BriefMax} characters.";
        }

        if (!Year(EraFrom, out _) || !Year(EraTo, out _))
        {
            return "A period is a year from 1900 to 2100, or empty.";
        }

        return null;
    }

    /// <summary>What the two times mean, in words, or null while either is not a time.</summary>
    /// <remarks>
    /// The two cases that look like mistakes and are not (an end before the start, the same time at
    /// both ends) are the ones worth saying out loud.
    /// </remarks>
    public string? Reading()
    {
        if (StationTime.ParseClock(StartsAt) is not { } start || StationTime.ParseClock(EndsAt, end: true) is not { } end)
        {
            return null;
        }

        if (start == end)
        {
            return "The same time at both ends is the whole day.";
        }

        var length = ((end - start) + StationTime.MinutesInDay) % StationTime.MinutesInDay;
        return end < start && end != 0
            ? $"Runs past midnight: {StationTime.Span(length)}."
            : $"Runs {StationTime.Span(length)}.";
    }

    /// <summary>
    /// What is sent, or null while <see cref="Problem"/> has something to say.
    /// </summary>
    /// <remarks>
    /// Every field goes, because <c>PUT</c> replaces the row. Calls and mixing in are sent only when
    /// ON: absent is no calls, and absent leaves the station's own mixing setting standing, so an
    /// unticked box sending <c>false</c> would override something nobody chose. Mixing in is sent only
    /// beside a playlist, since nothing else is ever mixed into; the chart order only beside a chart.
    /// </remarks>
    public ScheduleSlotInput? ToInput()
    {
        if (Problem() is not null)
        {
            return null;
        }

        Year(EraFrom, out var from);
        Year(EraTo, out var to);
        var brief = Brief.Trim();

        return new ScheduleSlotInput
        {
            Label = Label.Trim(),
            StartsAtMinutes = StationTime.ParseClock(StartsAt)!.Value,
            EndsAtMinutes = StationTime.ParseClock(EndsAt, end: true)!.Value,
            Days = [.. Days.Order().Select(day => (long)day)],
            SourcePluginId = (Source as ProgrammeSource.Playlist)?.PluginId,
            SourcePlaylistId = (Source as ProgrammeSource.Playlist)?.PlaylistId,
            SourceChartId = (Source as ProgrammeSource.Chart)?.ChartId,
            SourceChartOrder = Source is ProgrammeSource.Chart ? ChartOrder : null,
            SourceStationPlaylistId = (Source as ProgrammeSource.Station)?.PlaylistId,
            PersonaId = string.IsNullOrEmpty(PersonaId) ? null : PersonaId,
            Brief = brief.Length == 0 ? null : brief,
            EraFrom = from,
            EraTo = to,
            Callins = Callins ? true : null,
            MixInSimilar = MixInSimilar && ProgrammeSource.MixesInto(Source) ? true : null,
            Mood = Kept.Mood,
            StartsOn = Kept.StartsOn,
            EndsOn = Kept.EndsOn,
            Yearly = Kept.Yearly,
            GuestHosts = Kept.GuestHosts,
            CoHosts = Kept.CoHosts,
            Mode = Mode,
            OnEnd = OnEnd,
        };
    }

    /// <summary>An empty box is no bound; anything else has to be a year the station takes.</summary>
    private static bool Year(string text, out long? year)
    {
        year = null;
        var trimmed = text.Trim();
        if (trimmed.Length == 0)
        {
            return true;
        }

        if (!long.TryParse(trimmed, NumberStyles.None, CultureInfo.InvariantCulture, out var value) || value is < 1900 or > 2100)
        {
            return false;
        }

        year = value;
        return true;
    }
}

/// <summary>How a stored slot reads in the timetable's list.</summary>
public static class SlotText
{
    /// <summary>
    /// A slot's hours. An end of midnight reads <c>24:00</c>; the same time at both ends is the whole day.
    /// </summary>
    public static string Window(long startsAt, long endsAt) =>
        startsAt == endsAt || (startsAt == 0 && endsAt == StationTime.MinutesInDay)
            ? $"{StationTime.Clock(startsAt)}, all day"
            : $"{StationTime.Clock(startsAt)}–{StationTime.EndClock(endsAt)}";

    /// <summary>The weekday numbers as names, Sunday first. Absent, empty or all seven is every day.</summary>
    public static string Days(IEnumerable<long>? days)
    {
        var chosen = (days ?? []).Where(day => day is >= 0 and <= 6).Distinct().Order().ToList();
        if (chosen.Count is 0 or 7)
        {
            return "Every day";
        }

        return string.Join(", ", chosen.Select(day => StationTime.WeekdayNames[(int)day]));
    }

    /// <summary>
    /// When a slot runs: its weekdays for a weekly slot, and its dates for a special, which runs on
    /// those dates rather than every week (and is added and changed on the web console's Specials tab).
    /// </summary>
    public static string When(ScheduleSlot slot)
    {
        ArgumentNullException.ThrowIfNull(slot);

        if (slot.StartsOn is not { } from || slot.EndsOn is not { } to)
        {
            return Days(slot.Days);
        }

        // A yearly special's year is not part of it, so only the month and day are said.
        if (slot.Yearly == true)
        {
            return from == to ? $"Special, every year: {from[5..]}" : $"Special, every year: {from[5..]} to {to[5..]}";
        }

        return from == to ? $"Special: {from}" : $"Special: {from} to {to}";
    }
}

/// <summary>The fields of a slot the desktop editor carries without drawing. See <see cref="SlotDraft.Kept"/>.</summary>
public sealed record SlotPassthrough
{
    public ScheduleSlotMood? Mood { get; init; }

    /// <summary>A special's first date, <c>YYYY-MM-DD</c>; null on a weekly slot.</summary>
    public string? StartsOn { get; init; }

    public string? EndsOn { get; init; }

    public bool? Yearly { get; init; }

    /// <summary>Who sits in for the slot's host, and when; set on the web console.</summary>
    public List<SlotGuestHost>? GuestHosts { get; init; }

    /// <summary>Who presents beside the slot's host, and when; set on the web console.</summary>
    public List<SlotCoHost>? CoHosts { get; init; }
}
