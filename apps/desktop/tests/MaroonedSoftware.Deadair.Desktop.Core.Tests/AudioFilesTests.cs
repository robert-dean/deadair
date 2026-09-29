using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A recording from this Mac, as the station is told about it.
/// </summary>
/// <remarks>
/// The station takes or refuses an upload by its content type, so a wrong one is a refusal of a file
/// that is fine. And a file's name is the label it arrives with, which should read as what somebody
/// would have typed rather than as a file name.
/// </remarks>
public class AudioFilesTests
{
    [Theory]
    [InlineData("ident.MP3", "audio/mpeg")]
    [InlineData("bed.wav", "audio/wav")]
    [InlineData("sting.flac", "audio/flac")]
    [InlineData("jingle.m4a", "audio/mp4")]
    [InlineData("notes.txt", "application/octet-stream")]
    public void AFileIsSentAsTheTypeItsExtensionSays(string name, string type) => Assert.Equal(type, AudioFiles.ContentType(name));

    [Fact]
    public void ALabelIsTheNameWithoutItsExtensionOrSeparators() =>
        Assert.Equal("evening ident v3 FINAL", AudioFiles.LabelFor("evening_ident-v3__FINAL.wav"));

    [Theory]
    [InlineData(6_400L, "0:06")]
    [InlineData(214_000L, "3:34")]
    [InlineData(3_723_000L, "1:02:03")]
    [InlineData(null, "–")]
    public void ALengthReadsAsMinutesAndSeconds(long? ms, string said) => Assert.Equal(said, AudioFiles.Length(ms));
}
