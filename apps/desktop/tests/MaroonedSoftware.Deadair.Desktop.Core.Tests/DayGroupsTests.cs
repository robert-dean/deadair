using MaroonedSoftware.Deadair.Desktop.Core.History;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public sealed class DayGroupsTests
{
    private static readonly TimeZoneInfo Utc = TimeZoneInfo.Utc;

    private static DateTimeOffset At(string iso) => DateTimeOffset.Parse(iso, System.Globalization.CultureInfo.InvariantCulture);

    private static IReadOnlyList<DayGroup<DateTimeOffset>> Group(DateTimeOffset now, params string[] times) =>
        DayGroups.Of(times.Select(At).ToList(), moment => moment, now, Utc);

    [Fact]
    public void PutsWhatAiredTodayUnderToday()
    {
        var groups = Group(At("2026-09-08T12:00:00Z"), "2026-09-08T11:42:00Z", "2026-09-08T11:36:00Z");

        var group = Assert.Single(groups);
        Assert.Equal("Today", group.Label);
        Assert.Equal(2, group.Items.Count);
    }

    [Fact]
    public void BreaksAtLocalMidnightRatherThanAfterAFixedStretch()
    {
        // The reason this type exists: 23:40 sitting directly under 11:27 with nothing between them.
        var groups = Group(
            At("2026-09-08T12:00:00Z"),
            "2026-09-08T11:27:00Z",
            "2026-09-07T23:51:00Z",
            "2026-09-07T23:40:00Z");

        Assert.Equal(["Today", "Yesterday"], groups.Select(group => group.Label));
        Assert.Single(groups[0].Items);
        Assert.Equal(2, groups[1].Items.Count);
    }

    [Fact]
    public void MidnightItselfBelongsToTheDayItStarts()
    {
        var groups = Group(At("2026-09-08T12:00:00Z"), "2026-09-08T00:00:00Z", "2026-09-07T23:59:59Z");

        Assert.Equal(["Today", "Yesterday"], groups.Select(group => group.Label));
    }

    [Fact]
    public void NamesTheDayOnceItIsOlderThanYesterday()
    {
        var groups = Group(At("2026-09-08T12:00:00Z"), "2026-09-02T10:00:00Z");

        Assert.Equal("Wednesday 2 September", Assert.Single(groups).Label);
    }

    [Fact]
    public void CarriesTheYearOnlyWhenItIsNotThisOne()
    {
        // A heading reading "2026" on something that aired an hour ago is a heading doing paperwork.
        var groups = Group(At("2026-09-08T12:00:00Z"), "2025-12-30T10:00:00Z");

        Assert.Equal("30 December 2025", Assert.Single(groups).Label);
    }

    [Fact]
    public void KeepsTheOrderItWasGiven()
    {
        // The station answers newest first and this must not quietly re-sort: a history that shuffled
        // its own rows would be a history nobody could follow.
        var groups = Group(At("2026-09-08T12:00:00Z"), "2026-09-08T11:42:00Z", "2026-09-08T11:36:00Z");

        Assert.Equal([At("2026-09-08T11:42:00Z"), At("2026-09-08T11:36:00Z")], groups[0].Items);
    }

    [Fact]
    public void ReadsTheReadersOwnMidnightRatherThanTheMachines()
    {
        // 23:30 UTC is already tomorrow in Auckland, so the same two readings group differently
        // depending on who is looking. This is why the zone is an argument.
        var auckland = TimeZoneInfo.FindSystemTimeZoneById("Pacific/Auckland");
        var groups = DayGroups.Of(
            new[] { At("2026-09-07T23:30:00Z"), At("2026-09-07T10:00:00Z") },
            moment => moment,
            At("2026-09-08T00:00:00Z"),
            auckland);

        Assert.Equal(2, groups.Count);
    }

    [Fact]
    public void AnEmptyHistoryHasNoDays()
    {
        Assert.Empty(Group(At("2026-09-08T12:00:00Z")));
    }
}
