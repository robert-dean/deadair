using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class StudioBackdropsTests
{
    [Fact]
    public void TheGradientsAreTheDefault()
    {
        Assert.Equal(StudioBackdrops.Gradients, new DesktopSettings().StudioBackdrop);
        Assert.False(StudioBackdrops.FromCover(new DesktopSettings().StudioBackdrop));
    }

    [Fact]
    public void AFileWithoutTheKeyReadsAsTheGradients() =>
        Assert.Equal(StudioBackdrops.Gradients, JsonSerializer.Deserialize<DesktopSettings>("{}")!.StudioBackdrop);

    [Fact]
    public void AHandWrittenCoverIsRead_WhateverItsCase() =>
        Assert.True(StudioBackdrops.FromCover(JsonSerializer.Deserialize<DesktopSettings>("""{"studioBackdrop":" Cover "}""")!.StudioBackdrop));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("covers")]
    [InlineData("gradients")]
    public void AnythingElseIsTheGradients(string? value) => Assert.False(StudioBackdrops.FromCover(value));
}
