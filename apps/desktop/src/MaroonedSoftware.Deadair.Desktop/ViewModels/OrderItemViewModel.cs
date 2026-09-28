using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One row of the running order.</summary>
public sealed partial class OrderItemViewModel : ObservableObject
{
    /// <param name="artworkUrl">The cover, already resolved against the station; null for a segment, or a record without one.</param>
    public OrderItemViewModel(StationOrderItem item, bool canMove, Uri? artworkUrl = null)
    {
        ArgumentNullException.ThrowIfNull(item);

        Id = item.Id;
        Title = item.Title;
        Artists = string.Join(", ", item.Artists);
        IsSegment = item.Kind == StationOrderItemKind.Segment;
        State = item.State;
        CanMove = canMove;
        ArtworkUrl = artworkUrl;

        // A record can be put back where it was; a segment is marked removed and cannot. So undo is
        // offered for one and not the other, which is the station's rule rather than a choice here.
        TrackId = !IsSegment && Guid.TryParse(item.TrackId, out var trackId) ? trackId : null;
        CanUndoDrop = TrackId is not null;

        Length = item.DurationMs is { } ms && ms > 0
            ? TimeSpan.FromMilliseconds(ms).ToString(@"m\:ss", CultureInfo.InvariantCulture)
            : "--:--";

        (Label, Tone) = Describe(item.State);
    }

    public string Id { get; }

    public string Title { get; }

    public string Artists { get; }

    public string Length { get; }

    public bool IsSegment { get; }

    /// <summary>The row's cover, where the state dot used to be.</summary>
    public Uri? ArtworkUrl { get; }

    /// <summary>What the cover's place shows without one: a segment's, or a record's still loading.</summary>
    public string Initial => Title.Length == 0 ? "?" : char.ToUpperInvariant(Title[0]).ToString(CultureInfo.InvariantCulture);

    public StationItemState State { get; }

    public bool CanMove { get; }

    public bool CanUndoDrop { get; }

    public Guid? TrackId { get; }

    public string Label { get; }

    public StatusTone Tone { get; }

    public bool IsAiring => State == StationItemState.Airing;

    /// <summary>
    /// What each state is called, and what colour it reads as.
    /// </summary>
    /// <remarks>
    /// The half-step between skipped and unavailable is deliberate and comes from the console: the
    /// station passing over an item because it did its job is not the same as an item an operator has
    /// to go and fix, so they are a tone apart rather than sharing one.
    /// </remarks>
    private static (string Label, StatusTone Tone) Describe(StationItemState state) => state switch
    {
        StationItemState.Airing => ("On air", StatusTone.Live),
        StationItemState.Handed => ("Cued", StatusTone.Ok),
        StationItemState.Planned => ("Planned", StatusTone.Off),
        StationItemState.Played => ("Played", StatusTone.Off),
        StationItemState.Skipped => ("Skipped", StatusTone.Standby),
        StationItemState.Unavailable => ("Unavailable", StatusTone.Fault),
        StationItemState.Removed => ("Removed", StatusTone.Off),
        _ => ("", StatusTone.Off),
    };
}
