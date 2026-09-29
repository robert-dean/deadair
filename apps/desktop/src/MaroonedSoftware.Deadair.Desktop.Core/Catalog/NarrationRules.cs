using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Catalog;

/// <summary>Where a piece of a book or a column is, from the station's point of view.</summary>
public enum PieceState
{
    Read,
    Withdrawn,
    Ready,
    Reading,
    Failed,
    Unread,
}

/// <summary>
/// The rules of the Readings tab, from the web console's narrations page.
/// </summary>
public static class NarrationRules
{
    /// <summary>
    /// How long a reading that was asked for is drawn as in flight. Speaking a chapter is slow, so
    /// this is longer than an episode's fetch; one that has not answered by then is drawn as whatever
    /// it was before.
    /// </summary>
    public static readonly TimeSpan ReadingFor = TimeSpan.FromHours(1);

    /// <remarks>
    /// Asked in order: a piece that has aired is read whatever else is true, and one its source no
    /// longer lists is withdrawn even if it was spoken, because the station will not air it.
    /// </remarks>
    public static PieceState State(StationPiece piece, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(piece);

        if (piece.AiredAt is not null)
        {
            return PieceState.Read;
        }

        if (piece.WithdrawnAt is not null)
        {
            return PieceState.Withdrawn;
        }

        if (piece.Rendered)
        {
            return PieceState.Ready;
        }

        if (piece.Rendering
            || (DateTimeOffset.TryParse(piece.RenderRequestedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var asked)
                && now - asked < ReadingFor))
        {
            return PieceState.Reading;
        }

        return piece.RenderError is not null ? PieceState.Failed : PieceState.Unread;
    }

    public static (StatusTone Tone, string Label) Describe(PieceState state) => state switch
    {
        PieceState.Read => (StatusTone.Off, "Read"),
        PieceState.Withdrawn => (StatusTone.Off, "Withdrawn"),
        PieceState.Ready => (StatusTone.Ok, "Ready to air"),
        PieceState.Reading => (StatusTone.Standby, "Reading"),
        PieceState.Failed => (StatusTone.Fault, "Could not read"),
        _ => (StatusTone.Off, "Not read yet"),
    };

    /// <summary>A piece can be spoken now while it is not spoken, not withdrawn, and not already being spoken.</summary>
    public static bool CanRender(PieceState state) => state is PieceState.Failed or PieceState.Unread;

    /// <summary>
    /// Where a piece comes in a book, counted from one: the one thing a serial's operator navigates by.
    /// The station counts from zero.
    /// </summary>
    public static string? Position(long? ordinal) =>
        ordinal is { } place ? string.Create(CultureInfo.InvariantCulture, $"#{place + 1}") : null;

    public static string? Words(long? count) => count switch
    {
        null => null,
        1 => "1 word",
        { } words => string.Create(CultureInfo.CurrentCulture, $"{words:N0} words"),
    };
}
