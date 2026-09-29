using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The station's disk as figures, and the pictures it will take as break artwork.
/// </summary>
/// <remarks>
/// The console prints the same figures beside the same stores, in binary steps, so two readings of
/// one disk must agree. And a picture the station would refuse is turned away before its bytes go
/// anywhere, which only helps if the check is the station's own: the same types, the same four
/// megabytes.
/// </remarks>
public class StationStorageTests
{
    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(1536, "2 KB")]
    [InlineData(50_000_000_000, "46.6 GB")]
    [InlineData(5_000_000_000_000_000, "4,547.5 TB")]
    public void BytesReadAsTheConsolePrintsThem(long bytes, string expected) =>
        Assert.Equal(expected, ByteSize.Format(bytes, CultureInfo.InvariantCulture));

    [Fact]
    public void AStoreOverItsLimitReadsFullRatherThanPastFull() => Assert.Equal(100, ByteSize.Share(60, 50));

    [Fact]
    public void AStoreWithNoLimitHasNoShare() => Assert.Null(ByteSize.Share(60, null));

    [Fact]
    public void AStoreSaysWhatIsMissingAndWhatNothingClaims_OnlyWhenThereIsSomething()
    {
        var clean = StorageRowViewModel.From(Store(orphans: 0, missing: 0));
        var untidy = StorageRowViewModel.From(Store(orphans: 3, missing: 17));

        Assert.Null(clean.Missing);
        Assert.Equal("—", clean.Unclaimed);
        Assert.Contains("17", untidy.Missing, StringComparison.Ordinal);
        Assert.NotEqual("—", untidy.Unclaimed);
    }

    [Theory]
    [InlineData("cover.PNG", "image/png")]
    [InlineData("cover.jpeg", "image/jpeg")]
    [InlineData("cover.jpg", "image/jpeg")]
    [InlineData("cover.webp", "image/webp")]
    [InlineData("cover.gif", "image/gif")]
    [InlineData("cover.tiff", null)]
    public void APictureIsSentAsWhatItIs(string name, string? expected) => Assert.Equal(expected, ImageUpload.ContentType(name));

    [Fact]
    public void APictureLargerThanTheStationTakesIsTurnedAwayBeforeItIsSent()
    {
        Assert.NotNull(ImageUpload.Problem("big.png", ImageUpload.MaxBytes + 1));
        Assert.Null(ImageUpload.Problem("fine.png", ImageUpload.MaxBytes));
    }

    private static StorageStore Store(long orphans, long missing) => new()
    {
        Id = StorageStoreId.Tracks,
        Label = "Records",
        Path = "/var/lib/deadair/tracks",
        Files = 10,
        Bytes = 1024,
        OrphanFiles = orphans,
        OrphanBytes = orphans * 1024,
        RowsWithNoFile = missing,
    };
}
