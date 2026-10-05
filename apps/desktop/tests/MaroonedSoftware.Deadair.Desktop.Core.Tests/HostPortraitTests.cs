using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class HostPortraitTests
{
    private const string Portrait = "art/persona/cass";
    private const string CoverArt = "art/2f6c1e9a-0000-4000-8000-000000000001";

    private static NowPlayingTrack Record(string? artwork = CoverArt) =>
        new() { Title = "Alive", Artist = "Pearl Jam", StartedAt = 1_700_000_000_000, ArtworkUrl = artwork };

    private static NowPlayingTrack Break(string? artwork = null) => new()
    {
        Kind = NowPlayingTrackKind.Break,
        Title = "Talk break",
        Artist = string.Empty,
        StartedAt = 1_700_000_000_000,
        ArtworkUrl = artwork,
    };

    private static NowPlayingShow Show(string? host = "Cass", string? picture = Portrait) =>
        new() { Name = "Late Static", Host = host, HostArtUrl = picture };

    [Fact]
    public void ARecordKeepsItsOwnCoverAndHasThePortraitBesideTheLine()
    {
        Assert.Equal(CoverArt, HostPortrait.Cover(Record(), Show()));
        Assert.Equal(Portrait, HostPortrait.BesideLine(Record(), Show()));
    }

    [Fact]
    public void ARecordWithNoCoverKeepsItsInitial_TheRecordIsStillWhatIsOnAir()
    {
        Assert.Null(HostPortrait.Cover(Record(artwork: null), Show()));
        Assert.Equal(Portrait, HostPortrait.BesideLine(Record(artwork: null), Show()));
    }

    [Fact]
    public void ABreakTakesThePortraitAsItsCover_AndDoesNotDrawItTwice()
    {
        Assert.Equal(Portrait, HostPortrait.Cover(Break(), Show()));
        Assert.Null(HostPortrait.BesideLine(Break(), Show()));
    }

    [Fact]
    public void ABreakWithArtOfItsOwnKeepsIt_AndThePortraitGoesBesideTheLine()
    {
        Assert.Equal(CoverArt, HostPortrait.Cover(Break(artwork: CoverArt), Show()));
        Assert.Equal(Portrait, HostPortrait.BesideLine(Break(artwork: CoverArt), Show()));
    }

    [Fact]
    public void ABreakWithNoNameStillShowsWhoIsTalking() =>
        Assert.Equal(Portrait, HostPortrait.Cover(Break(), Show(host: null)));

    [Fact]
    public void NoPortraitWhereThereIsNoLine()
    {
        // A record with nobody to name draws no line, so a picture beside nothing would be a stray.
        Assert.Null(HostPortrait.BesideLine(Record(), Show(host: null)));
        Assert.Null(HostPortrait.BesideLine(null, Show()));
        Assert.Null(HostPortrait.Cover(null, Show()));
    }

    [Fact]
    public void WithoutAPictureEverythingIsAsItWas()
    {
        // A persona with no picture, and a station older than the field, both leave it absent.
        Assert.Null(HostPortrait.BesideLine(Record(), Show(picture: null)));
        Assert.Null(HostPortrait.BesideLine(Record(), Show(picture: "  ")));
        Assert.Null(HostPortrait.BesideLine(Break(), Show(picture: null)));
        Assert.Null(HostPortrait.Cover(Break(), Show(picture: null)));
        Assert.Null(HostPortrait.Cover(Break(), null));
        Assert.Equal(CoverArt, HostPortrait.Cover(Record(), Show(picture: null)));
    }
}
