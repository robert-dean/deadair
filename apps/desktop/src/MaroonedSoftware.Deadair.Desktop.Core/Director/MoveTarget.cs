using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Director;

/// <summary>
/// Where an item may be moved to, and where it may not.
/// </summary>
/// <remarks>
/// <para>
/// The station <b>refuses</b> a move into a position the player already holds rather than clamping it
/// to the nearest legal one. That is the right behaviour — silently doing something other than what
/// was asked is worse — and it means the client has to know the floor, or every drag onto the top of
/// a busy order is a request that comes back rejected.
/// </para>
/// <para>
/// The floor is the first item still <c>planned</c>: everything above it has been handed to the
/// player, is airing, or has been.
/// </para>
/// </remarks>
public static class MoveTarget
{
    /// <summary>The lowest index an item can be moved to, or the count when nothing is movable.</summary>
    public static int Floor(IReadOnlyList<StationOrderItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);

        for (var index = 0; index < items.Count; index++)
        {
            if (items[index].State == StationItemState.Planned)
            {
                return index;
            }
        }

        return items.Count;
    }

    /// <summary>Whether this item is still the operator's to move.</summary>
    public static bool CanMove(IReadOnlyList<StationOrderItem> items, string itemId)
    {
        ArgumentNullException.ThrowIfNull(items);

        var index = IndexOf(items, itemId);
        return index >= 0 && index >= Floor(items) && items[index].State == StationItemState.Planned;
    }

    /// <summary>Where "send to the top" actually means, which is the floor rather than zero.</summary>
    public static int? ToTop(IReadOnlyList<StationOrderItem> items, string itemId)
    {
        if (!CanMove(items, itemId))
        {
            return null;
        }

        var floor = Floor(items);
        var index = IndexOf(items, itemId);

        return index == floor ? null : floor;
    }

    /// <summary>One place earlier, or null when it is already as early as it may go.</summary>
    public static int? Up(IReadOnlyList<StationOrderItem> items, string itemId)
    {
        if (!CanMove(items, itemId))
        {
            return null;
        }

        var index = IndexOf(items, itemId);
        return index <= Floor(items) ? null : index - 1;
    }

    /// <summary>One place later, or null when it is last.</summary>
    public static int? Down(IReadOnlyList<StationOrderItem> items, string itemId)
    {
        ArgumentNullException.ThrowIfNull(items);

        if (!CanMove(items, itemId))
        {
            return null;
        }

        var index = IndexOf(items, itemId);
        return index >= items.Count - 1 ? null : index + 1;
    }

    private static int IndexOf(IReadOnlyList<StationOrderItem> items, string itemId)
    {
        for (var index = 0; index < items.Count; index++)
        {
            if (string.Equals(items[index].Id, itemId, StringComparison.Ordinal))
            {
                return index;
            }
        }

        return -1;
    }
}
