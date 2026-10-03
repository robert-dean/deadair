using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class StudioDriftTests
{
    [Fact]
    public void TheLoopHasNoSeam()
    {
        // Whole-number frequencies: the end of the loop is exactly its start, so nothing jumps.
        var start = StudioDrift.At(0);
        var end = StudioDrift.At(1);

        for (var index = 0; index < start.Count; index++)
        {
            Assert.Equal(start[index].X, end[index].X, 9);
            Assert.Equal(start[index].Y, end[index].Y, 9);
        }
    }

    [Fact]
    public void ItActuallyMoves() => Assert.NotEqual(StudioDrift.At(0)[0], StudioDrift.At(0.25)[0]);

    [Fact]
    public void ASmallStepIsASmallMove()
    {
        // One frame's worth of a slow loop must not visibly hop.
        for (var phase = 0.0; phase < 1; phase += 0.01)
        {
            var now = StudioDrift.At(phase);
            var next = StudioDrift.At(phase + 0.001);
            for (var index = 0; index < now.Count; index++)
            {
                Assert.True(Math.Abs(now[index].X - next[index].X) < 0.005);
                Assert.True(Math.Abs(now[index].Y - next[index].Y) < 0.005);
            }
        }
    }

    [Fact]
    public void EveryPatchStaysOnTheBackdrop()
    {
        for (var phase = 0.0; phase < 1; phase += 0.005)
        {
            Assert.All(StudioDrift.At(phase), patch =>
            {
                Assert.InRange(patch.X, 0, 1);
                Assert.InRange(patch.Y, 0, 1);
            });
        }
    }

    [Fact]
    public void ThereIsAPatchForEachColourStudioWillUse() => Assert.Equal(StudioDrift.Patches, StudioDrift.At(0.4).Count);

    [Fact]
    public void AdvanceWrapsRoundTheLoop()
    {
        Assert.Equal(0.5, StudioDrift.Advance(0.25, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(120)), 9);
        Assert.Equal(0.25, StudioDrift.Advance(0.75, TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(120)), 9);
    }

    [Fact]
    public void EaseApproachesWithoutOvershooting()
    {
        var speed = StudioDrift.Ease(0.2, 1, TimeSpan.FromMilliseconds(50), TimeSpan.FromSeconds(1.5));
        Assert.InRange(speed, 0.2, 1);
        Assert.True(speed > 0.2);

        Assert.Equal(1, StudioDrift.Ease(0.2, 1, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(1.5)));
        Assert.InRange(StudioDrift.Ease(1, 0.2, TimeSpan.FromMilliseconds(50), TimeSpan.FromSeconds(1.5)), 0.2, 1);
    }

    [Fact]
    public void MixRunsFromOneColourToTheOther()
    {
        Assert.Equal(0xFF000000u, StudioDrift.Mix(0xFF000000, 0xFFFFFFFF, 0));
        Assert.Equal(0xFFFFFFFFu, StudioDrift.Mix(0xFF000000, 0xFFFFFFFF, 1));
        Assert.Equal(0xFF808080u, StudioDrift.Mix(0xFF000000, 0xFFFFFFFF, 0.5));
        Assert.Equal(0xFFFFFFFFu, StudioDrift.Mix(0xFF000000, 0xFFFFFFFF, 7));
    }

    [Fact]
    public void ACoverWithFewerColoursFadesItsSparePatchesIntoItsGround()
    {
        IReadOnlyList<uint> from = [0xFF402020, 0xFF204020, 0xFF202040];
        IReadOnlyList<uint> to = [0xFF303030];

        var blended = StudioDrift.Blend(from, to, 1);

        Assert.Equal(StudioDrift.Patches, blended.Count);
        Assert.Equal(0xFF303030u, blended[0]);
        Assert.Equal(StudioDrift.Ground(to), blended[1]);
        Assert.Equal(StudioDrift.Ground(to), blended[2]);
    }

    [Fact]
    public void BlendStartsWhereTheOldCoverWas()
    {
        IReadOnlyList<uint> from = [0xFF402020, 0xFF204020];
        Assert.Equal(from[1], StudioDrift.Blend(from, [], 0)[1]);
    }

    [Fact]
    public void NoCoverHasAGroundOfItsOwn() => Assert.Equal(StudioDrift.NoCover, StudioDrift.Ground([]));

    [Fact]
    public void TheGroundIsDarkerThanTheCoversMainColour()
    {
        var ground = StudioDrift.Ground([0xFF6040A0]);
        Assert.True((ground >> 16 & 0xFF) < 0x60);
        Assert.True((ground & 0xFF) < 0xA0);
    }
}
