using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A production as its row, and what may still be called off.
/// </summary>
/// <remarks>
/// The cast answers "why was there somebody else in that programme", from what was stored rather than
/// from a roster that may have changed since. And cancellability is a list of the states that CAN be
/// cancelled, so a stage added upstream is not cancellable by omission.
/// </remarks>
public class ProductionRowTests
{
    [Fact]
    public void TheCastNamesWhoPresentsAndWhoRingsIn()
    {
        List<ProductionCastMember> cast =
        [
            new() { Role = ProductionCastMemberRole.Host, Name = "Marla" },
            new() { Role = ProductionCastMemberRole.Caller, Name = "Dennis" },
            new() { Role = ProductionCastMemberRole.Caller, Name = "Wendy" },
        ];

        Assert.Equal("presented by Marla, with Dennis and Wendy", ProductionsViewModel.CastLine(cast));
        Assert.Equal("2 voices", ProductionsViewModel.CastLine([new() { Role = ProductionCastMemberRole.Host }, new() { Role = ProductionCastMemberRole.Caller }]));
    }

    [Theory]
    [InlineData(ProductionState.Drafting, true)]
    [InlineData(ProductionState.Stitching, true)]
    [InlineData(ProductionState.Ready, false)]
    [InlineData(ProductionState.Aired, false)]
    [InlineData(ProductionState.Cancelled, false)]
    public void OnlyAProductionStillBeingMadeCanBeCalledOff(ProductionState state, bool cancellable) =>
        Assert.Equal(cancellable, ProductionsViewModel.IsCancellable(state));

    [Fact]
    public void ARowSaysItsStateInPlainWordsAndHowFarAlongItIs()
    {
        var row = ProductionsViewModel.Row(new Production
        {
            Id = "p",
            Kind = "podcast",
            Title = "t",
            WritingMode = ProductionWritingMode.Polished,
            TargetMs = 900_000,
            State = ProductionState.Rendering,
            Beats = 1,
            Cast = [],
            CreatedAt = DateTimeOffset.UnixEpoch,
        });

        Assert.Equal("speaking it", row.State);
        Assert.Equal("about 15 minutes · polished write · 1 beat written", row.Details);
        Assert.Null(row.Cast);
    }
}
