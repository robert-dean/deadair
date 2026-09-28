using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Which of a cover's colours the app wears, and that it reads where it is worn. The first seven
/// are the Android app's <c>CoverAccentTest</c>, ported; the rest are this app's header and sampling.
/// </summary>
public class CoverColoursTests
{
    private const uint Black = 0xFF000000;
    private const uint White = 0xFFFFFFFF;
    private const uint GrassGreen = 0xFF3A9A4A;
    private const uint OffWhite = 0xFFEDE8E0;
    private const uint Navy = 0xFF14244A;
    private const uint PaleYellow = 0xFFF8EFA0;
    private const uint Grey = 0xFF808080;

    [Fact]
    public void WearsTheMostColourfulOfTheCoversColoursNotItsBackground()
    {
        var accent = CoverColours.Accent([OffWhite, GrassGreen, Black], darkPage: true)!.Value.Accent;

        Assert.True(Green(accent) > Red(accent) && Green(accent) > Blue(accent));
    }

    [Fact]
    public void KeepsTheThemeForACoverWithNoColourInIt() =>
        Assert.Null(CoverColours.Accent([Black, White, Grey], darkPage: true));

    [Fact]
    public void KeepsTheThemeWhenTheCoverGaveNothing() =>
        Assert.Null(CoverColours.Accent([], darkPage: true));

    [Fact]
    public void LiftsADarkColourUntilItReadsOnADarkPageKeepingItBlue()
    {
        var accent = CoverColours.Accent([Navy], darkPage: true)!.Value.Accent;

        Assert.True(Lightness(accent) > Lightness(Navy));
        Assert.True(Blue(accent) > Red(accent) && Blue(accent) > Green(accent));
    }

    [Fact]
    public void DarkensAPaleColourUntilItReadsOnALightPage() =>
        Assert.True(Lightness(CoverColours.Accent([PaleYellow], darkPage: false)!.Value.Accent) < Lightness(PaleYellow));

    [Fact]
    public void PutsBlackOnALightAccentAndWhiteOnADarkOne()
    {
        Assert.Equal(Black, CoverColours.Accent([PaleYellow], darkPage: true)!.Value.OnAccent);
        Assert.Equal(White, CoverColours.Accent([Navy], darkPage: false)!.Value.OnAccent);
    }

    [Fact]
    public void ReadsBlackOnWhiteAndWhiteOnBlack()
    {
        Assert.Equal(Black, CoverColours.ReadableOn(White));
        Assert.Equal(White, CoverColours.ReadableOn(Black));
    }

    [Fact]
    public void HeadsThePageInTheMostColourfulColour()
    {
        var tint = CoverColours.HeaderTint([OffWhite, GrassGreen, Black], darkPage: true)!.Value;

        Assert.True(Green(tint) > Red(tint) && Green(tint) > Blue(tint));
    }

    /// <summary>White type sits over it, so on a dark page it is dim whatever the cover was.</summary>
    [Fact]
    public void DimsTheHeaderOnADarkPageSoWhiteTextReads() =>
        Assert.Equal(White, CoverColours.ReadableOn(CoverColours.HeaderTint([PaleYellow], darkPage: true)!.Value));

    [Fact]
    public void PalesTheHeaderOnALightPageSoDarkTextReads() =>
        Assert.Equal(Black, CoverColours.ReadableOn(CoverColours.HeaderTint([Navy], darkPage: false)!.Value));

    /// <summary>A mood rather than a control, so a grey cover gets a grey header rather than none.</summary>
    [Fact]
    public void KeepsABlackAndWhiteCoverGreyRatherThanInventingAColour()
    {
        var tint = CoverColours.HeaderTint([Black, White], darkPage: true)!.Value;

        Assert.Equal(Red(tint), Green(tint));
        Assert.Equal(Green(tint), Blue(tint));
    }

    [Fact]
    public void HeadsNothingWhenTheCoverGaveNothing() =>
        Assert.Null(CoverColours.HeaderTint([], darkPage: true));

    [Fact]
    public void SamplesTheCoversCommonestColoursFirst()
    {
        uint[] pixels = [.. Enumerable.Repeat(Navy, 30), .. Enumerable.Repeat(GrassGreen, 10), Grey];

        var candidates = CoverColours.Candidates(pixels, count: 2);

        Assert.Equal([Navy, GrassGreen], candidates);
    }

    [Fact]
    public void LeavesTransparentPixelsOut()
    {
        uint[] pixels = [.. Enumerable.Repeat(0x00FF0000u, 50), Navy];

        Assert.Equal([Navy], CoverColours.Candidates(pixels));
    }

    private static uint Red(uint argb) => argb >> 16 & 0xFF;

    private static uint Green(uint argb) => argb >> 8 & 0xFF;

    private static uint Blue(uint argb) => argb & 0xFF;

    private static uint Lightness(uint argb) =>
        (Math.Max(Red(argb), Math.Max(Green(argb), Blue(argb))) + Math.Min(Red(argb), Math.Min(Green(argb), Blue(argb)))) / 2;
}
