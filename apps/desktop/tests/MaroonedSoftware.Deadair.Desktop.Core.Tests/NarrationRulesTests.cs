using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Where a piece of a book or a column is, and when it can be read now.
/// </summary>
/// <remarks>
/// A piece its source no longer lists will not be aired, whatever the station already spoke of it, so
/// offering Read it now on one would be offering work the station throws away. And a chapter is where
/// it comes in its book counted from one, while the station counts from zero.
/// </remarks>
public class NarrationRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    private static StationPiece Piece() => new()
    {
        Id = "p",
        SeriesId = "s",
        PieceId = "x",
        SeriesTitle = "Great Expectations",
        Title = "Chapter VII",
        Order = StationPieceOrder.Serial,
        SeenAt = "2026-09-20T00:00:00Z",
        Rendered = false,
        Rendering = false,
    };

    [Fact]
    public void AWithdrawnPieceIsWithdrawnEvenIfItWasSpoken()
    {
        var state = NarrationRules.State(Piece() with { WithdrawnAt = "2026-09-27T09:00:00Z", Rendered = true }, Now);

        Assert.Equal(PieceState.Withdrawn, state);
        Assert.False(NarrationRules.CanRender(state));
    }

    [Fact]
    public void AReadPieceIsReadWhateverElseIsTrue() =>
        Assert.Equal(PieceState.Read, NarrationRules.State(Piece() with { AiredAt = "2026-09-28T21:00:00Z", WithdrawnAt = "2026-09-29T00:00:00Z" }, Now));

    [Fact]
    public void AReadingAskedForWithinTheHourIsStillReading() =>
        Assert.Equal(PieceState.Reading, NarrationRules.State(Piece() with { RenderRequestedAt = "2026-09-29T11:20:00Z", RenderError = "old" }, Now));

    [Fact]
    public void AFailedPieceCanBeReadAgain()
    {
        var state = NarrationRules.State(Piece() with { RenderError = "no mixer" }, Now);

        Assert.Equal(PieceState.Failed, state);
        Assert.True(NarrationRules.CanRender(state));
    }

    [Theory]
    [InlineData(0L, "#1")]
    [InlineData(6L, "#7")]
    [InlineData(null, null)]
    public void APositionIsCountedFromOne(long? ordinal, string? expected) => Assert.Equal(expected, NarrationRules.Position(ordinal));
}
