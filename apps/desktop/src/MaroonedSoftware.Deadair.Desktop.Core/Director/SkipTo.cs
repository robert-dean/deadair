using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Director;

/// <summary>Which items the station can be skipped straight to.</summary>
/// <remarks>
/// A RECORD still to come, and the station refuses anything else with a 422: a break's words are
/// about the records around it, so jumping into one would air a back-announce for a record just
/// skipped. A record the player already holds counts, where it does not for a move or a drop, because
/// the skip takes the player's queue back itself; reaching past it is the point.
/// </remarks>
public static class SkipTo
{
    public static bool Allowed(StationOrderItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        return item.Kind == StationOrderItemKind.Track
            && item.State is StationItemState.Planned or StationItemState.Handed;
    }
}
