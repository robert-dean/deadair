using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// A sound on the rack: the token a script writes, and what a re-scan did.
/// </summary>
/// <remarks>
/// The token is the only spelling the station's parser will find, so a name has to arrive in its
/// shape; a sound uploaded as "Air Horn" would be a sound no script could ever reach. And a re-scan
/// that could not put a sound on its set has left it in the library where nothing can reach it, which
/// is the one outcome worth stopping for.
/// </remarks>
public class PadTextTests
{
    [Theory]
    [InlineData("Air Horn (Stadium) 03.wav", "air-horn-stadium-03")]
    [InlineData("airhorn.mp3", "airhorn")]
    [InlineData("--rim.shot--", "rim")]
    public void AFileNameBecomesASoundNameInTheTokensShape(string file, string name) => Assert.Equal(name, PadText.NameFor(file));

    [Fact]
    public void TheTokenIsWrittenExactlyAsAScriptWritesIt() => Assert.Equal("[sfx:airhorn]", PadText.Token("airhorn"));

    [Fact]
    public void ALoudnessNobodyMeasuredIsADash_AndALastHitNeverIsSaidInWords()
    {
        Assert.Equal("–", PadText.Loudness(null));
        Assert.Equal("-9.2 LUFS", PadText.Loudness(-9.2));
        Assert.Equal("never", PadText.LastHit(null));
    }

    [Fact]
    public void AScanThatLeftASoundUnreachableSaysSo()
    {
        var quiet = new PadScanResult { Scanned = 4, Imported = 1, Replaced = 0, Contested = 0, Skipped = 3 };
        var contested = quiet with { Contested = 1 };

        Assert.Equal("Read 4 files: 1 new, 0 replaced, 3 passed over.", PadText.ScanSummary(quiet));
        Assert.Contains("nothing can reach it yet", PadText.ScanSummary(contested), StringComparison.Ordinal);
    }
}
