using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class StudioCoverMotionTests
{
    [Fact]
    public void TheLoopHasNoSeam()
    {
        Assert.Equal(StudioCoverMotion.Zoom(0), StudioCoverMotion.Zoom(1), 9);

        var start = StudioCoverMotion.Discs(0);
        var end = StudioCoverMotion.Discs(1);
        for (var index = 0; index < start.Count; index++)
        {
            Assert.Equal(Math.Cos(start[index].Angle), Math.Cos(end[index].Angle), 9);
            Assert.Equal(Math.Sin(start[index].Angle), Math.Sin(end[index].Angle), 9);
        }
    }

    [Fact]
    public void TheZoomBreathesAboutItsCentreAndNeverShowsAnEdge()
    {
        for (var phase = 0.0; phase < 1; phase += 0.01)
        {
            var zoom = StudioCoverMotion.Zoom(phase);
            Assert.InRange(zoom, StudioCoverMotion.BaseZoom - StudioCoverMotion.ZoomSwing - 1e-9, StudioCoverMotion.BaseZoom + StudioCoverMotion.ZoomSwing + 1e-9);
            Assert.True(zoom > 1);
        }
    }

    [Fact]
    public void TheTwoDiscsTurnOppositeWays_FromPivotsNearOppositeCorners()
    {
        var discs = StudioCoverMotion.Discs(0.1);

        Assert.Equal(2, discs.Count);
        Assert.True(discs[0].Angle > 0);
        Assert.True(discs[1].Angle < 0);
        Assert.Equal(Math.Sign(discs[0].X), -Math.Sign(discs[1].X));
        Assert.Equal(Math.Sign(discs[0].Y), -Math.Sign(discs[1].Y));
        Assert.Equal(0.55, discs[0].Weight);
        Assert.Equal(0.45, discs[1].Weight);
    }

    [Fact]
    public void ASmallStepIsASmallTurn()
    {
        for (var phase = 0.0; phase < 1; phase += 0.01)
        {
            var now = StudioCoverMotion.Discs(phase);
            var next = StudioCoverMotion.Discs(phase + 0.001);
            for (var index = 0; index < now.Count; index++)
            {
                Assert.True(Math.Abs(now[index].Angle - next[index].Angle) < 0.01);
            }

            Assert.True(Math.Abs(StudioCoverMotion.Zoom(phase) - StudioCoverMotion.Zoom(phase + 0.001)) < 0.001);
        }
    }

    [Fact]
    public void TheFadeStartsAndEndsWhereItShould_AndOnlyGoesOneWay()
    {
        Assert.Equal(0, StudioCoverMotion.FadeWeight(-1));
        Assert.Equal(0, StudioCoverMotion.FadeWeight(0));
        Assert.Equal(0.5, StudioCoverMotion.FadeWeight(0.5), 9);
        Assert.Equal(1, StudioCoverMotion.FadeWeight(1));
        Assert.Equal(1, StudioCoverMotion.FadeWeight(2));

        var last = 0.0;
        for (var t = 0.0; t <= 1; t += 0.05)
        {
            var weight = StudioCoverMotion.FadeWeight(t);
            Assert.True(weight >= last);
            last = weight;
        }
    }

    [Fact]
    public void AWhiteCoverIsWalkedDarkUntilWhiteReadsOnIt()
    {
        uint[] white = [.. Enumerable.Repeat(0xFFFFFFFFu, 64)];

        var dim = StudioCoverMotion.Dim(white);

        Assert.True(dim < 0.6);
        Assert.Equal(0xFFFFFFFFu, CoverColours.ReadableOn(StudioCoverMotion.Scale(0xFFFFFFFF, dim)));
    }

    [Fact]
    public void ADarkCoverKeepsTheCeiling() =>
        Assert.Equal(0.6, StudioCoverMotion.Dim([.. Enumerable.Repeat(0xFF101418u, 64)]));

    [Fact]
    public void OneStrayHighlightDoesNotDarkenADarkCover()
    {
        var pixels = Enumerable.Repeat(0xFF101418u, 63).Append(0xFFFFFFFFu).ToArray();

        Assert.Equal(0.6, StudioCoverMotion.Dim(pixels));
    }

    [Fact]
    public void NoPixelsAnswerTheCeiling() => Assert.Equal(0.5, StudioCoverMotion.Dim([], 0.5));

    [Fact]
    public void ScaleDarkensEveryChannelAndStaysOpaque() =>
        Assert.Equal(0xFF402010u, StudioCoverMotion.Scale(0x00804020, 0.5));
}
