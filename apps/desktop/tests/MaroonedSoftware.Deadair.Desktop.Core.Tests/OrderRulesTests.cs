using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Where an item may be moved to, and when the order runs out.
/// </summary>
public class OrderRulesTests
{
    private static StationOrderItem Item(string id, StationItemState state, long? durationMs = 180_000) => new()
    {
        Id = id,
        Kind = StationOrderItemKind.Track,
        State = state,
        Title = id,
        Artists = ["Somebody"],
        DurationMs = durationMs,
    };

    private static List<StationOrderItem> AnOrder() =>
    [
        Item("played", StationItemState.Played),
        Item("airing", StationItemState.Airing),
        Item("cued", StationItemState.Handed),
        Item("a", StationItemState.Planned),
        Item("b", StationItemState.Planned),
        Item("c", StationItemState.Planned),
    ];

    [Fact]
    public void TheFloorIsTheFirstItemTheStationHasNotHandedOver()
    {
        // Everything above it is airing, has aired, or is already in the player's hands. The station
        // refuses a move into that region rather than clamping, so the client has to know where it
        // ends or every "send to top" comes back rejected.
        Assert.Equal(3, MoveTarget.Floor(AnOrder()));
    }

    [Fact]
    public void OnlyAPlannedItemMayMove()
    {
        var items = AnOrder();

        Assert.True(MoveTarget.CanMove(items, "b"));
        Assert.False(MoveTarget.CanMove(items, "airing"));
        Assert.False(MoveTarget.CanMove(items, "cued"));
        Assert.False(MoveTarget.CanMove(items, "played"));
    }

    [Fact]
    public void SendToTopMeansTheFloorRatherThanZero()
    {
        // Zero is where the played item is. Asking for it is asking the station to put a record
        // somewhere the broadcast has already been.
        Assert.Equal(3, MoveTarget.ToTop(AnOrder(), "c"));
    }

    [Fact]
    public void AnItemAlreadyAtTheFloorHasNowhereToGo()
    {
        // Null rather than its own index, so the caller does nothing instead of sending a request that
        // changes nothing.
        Assert.Null(MoveTarget.ToTop(AnOrder(), "a"));
        Assert.Null(MoveTarget.Up(AnOrder(), "a"));
    }

    [Fact]
    public void TheLastItemCannotGoDown()
    {
        Assert.Null(MoveTarget.Down(AnOrder(), "c"));
        Assert.Equal(5, MoveTarget.Down(AnOrder(), "b"));
    }

    [Fact]
    public void RefusesToMoveSomethingTheStationWouldRefuse()
    {
        var items = AnOrder();

        Assert.Null(MoveTarget.Up(items, "cued"));
        Assert.Null(MoveTarget.Down(items, "airing"));
        Assert.Null(MoveTarget.ToTop(items, "played"));
    }

    [Fact]
    public void CountsOnlyTheAirtimeStillAhead()
    {
        // Airing, cued and three planned: five items of three minutes. What has played is not time
        // anybody still gets.
        Assert.Equal(TimeSpan.FromMinutes(15), RunsDry.Remaining(AnOrder()));
    }

    [Fact]
    public void AnItemWithNoLengthContributesNothingRatherThanAGuess()
    {
        List<StationOrderItem> items =
        [
            Item("a", StationItemState.Planned),
            Item("nolength", StationItemState.Planned, durationMs: null),
        ];

        // Slightly early beats confidently wrong: an operator who is told the order runs out sooner
        // than it does extends it, and nothing is lost.
        Assert.Equal(TimeSpan.FromMinutes(3), RunsDry.Remaining(items));
    }

    [Fact]
    public void SaysNothingWhenNothingAheadHasALength()
    {
        List<StationOrderItem> items = [Item("nolength", StationItemState.Planned, durationMs: null)];

        Assert.Null(RunsDry.Remaining(items));
        Assert.Null(RunsDry.At(items, DateTimeOffset.UtcNow));
    }

    [Fact]
    public void WarnsOnlyWhenTheOrderIsActuallyShort()
    {
        // An hour of records, which is what a running order looks like when nobody needs telling
        // anything about it.
        var full = Enumerable.Range(0, 20)
            .Select(index => Item($"track{index}", StationItemState.Planned))
            .ToList();

        List<StationOrderItem> nearlyEmpty = [Item("last", StationItemState.Planned)];

        // On screen for most of a broadcast is on screen for nobody. The six-item fixture the other
        // tests use is FIFTEEN minutes and is itself short, which is what this assertion caught.
        Assert.False(RunsDry.IsShort(full));
        Assert.True(RunsDry.IsShort(nearlyEmpty));
        Assert.True(RunsDry.IsShort(AnOrder()));
    }

    [Fact]
    public void AnEmptyOrderHasNoFloorToMoveInto()
    {
        Assert.Equal(0, MoveTarget.Floor([]));
        Assert.False(MoveTarget.CanMove([], "anything"));
    }
}
