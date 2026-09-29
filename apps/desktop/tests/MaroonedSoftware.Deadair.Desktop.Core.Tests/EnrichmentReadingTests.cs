using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What the providers said, as the card draws it.
/// </summary>
/// <remarks>
/// A source that answered with nothing and one that could not be reached used to share the words
/// "nothing found", and they are opposite facts: the first is settled and the second is the walk still
/// owing the record an answer. And a link an upstream supplied is drawn as a link only when it is
/// http(s), because it points at whatever somebody else said.
/// </remarks>
public class EnrichmentReadingTests
{
    private static readonly DateTimeOffset Fetched = new(2026, 8, 30, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(false, true, "lastfm · 30 Aug 2026", StatusTone.Ok)]
    [InlineData(false, false, "lastfm · nothing found", StatusTone.Off)]
    [InlineData(true, false, "lastfm · could not ask", StatusTone.Standby)]
    [InlineData(true, true, "lastfm · 30 Aug 2026, could not re-ask", StatusTone.Standby)]
    public void ASourceSaysWhichOfFourThingsItIs(bool failed, bool found, string expected, StatusTone tone)
    {
        var row = EnrichmentReading.Source("lastfm", Fetched, stale: false, found, failed, CultureInfo.GetCultureInfo("en-GB"));

        Assert.Equal(expected, row.Text);
        Assert.Equal(tone, row.Tone);
    }

    [Fact]
    public void AStaleSourceIsDueAgain() =>
        Assert.EndsWith("· due again", EnrichmentReading.Source("lastfm", Fetched, stale: true, found: true, failed: false).Text, StringComparison.Ordinal);

    [Fact]
    public void AFullReleaseDateWinsOverABareYear()
    {
        var pairs = EnrichmentReading.PairsOf("1994-04-26", 1994, null, null, null, null);

        Assert.Equal(new EnrichmentPair("Providers say released", "1994-04-26"), Assert.Single(pairs));
    }

    [Fact]
    public void AFourCharacterDateIsAYearAndTheYearIsUsed() =>
        Assert.Equal("1991", Assert.Single(EnrichmentReading.PairsOf("1991", 1991, null, null, null, null)).Value);

    [Fact]
    public void OnlyWebLinksAreKept()
    {
        var reading = EnrichmentReading.From(new ArtistEnrichmentDetail
        {
            ArtistId = Guid.NewGuid(),
            Merged = new ArtistEnrichmentData
            {
                Links = [new() { Label = "Site", Url = "https://example.org" }, new() { Label = "Odd", Url = "javascript:alert(1)" }],
            },
            Sources = [],
            Claims = [],
        });

        Assert.Equal("Site", Assert.Single(reading.Links).Label);
    }

    [Fact]
    public void NobodyAskedIsEmptyRatherThanABlankCard()
    {
        var reading = EnrichmentReading.From(new AlbumEnrichmentDetail
        {
            AlbumId = Guid.NewGuid(),
            Merged = new AlbumEnrichmentData(),
            Sources = [],
            Claims = [],
        });

        Assert.True(reading.IsEmpty);
    }
}
