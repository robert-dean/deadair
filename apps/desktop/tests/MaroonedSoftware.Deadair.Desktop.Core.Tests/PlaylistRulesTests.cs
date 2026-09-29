using System.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// How the Playlists tab sorts, gates and imports playlists.
/// </summary>
/// <remarks>
/// A playlist whose tracks a source will not share cannot be aired or refreshed either, and one that
/// says nothing about permissions must still be usable, or every source without a notion of sharing
/// would offer nothing. An import sends a station's own export as a file and everything else as text,
/// and a JSON file that does not parse is said here rather than sent to be refused.
/// </remarks>
public class PlaylistRulesTests
{
    private static CatalogPlaylist Playlist(bool? hidden = null, bool? made = null, List<PlaylistPermission>? permissions = null) => new()
    {
        PluginId = "ytmusic",
        PluginName = "YouTube Music",
        Id = Guid.NewGuid().ToString(),
        Name = "x",
        Hidden = hidden,
        MadeByProvider = made,
        Permissions = permissions,
    };

    [Fact]
    public void APlaylistThatSaysNothingAboutPermissionsCanBeRead() => Assert.True(PlaylistRules.CanReadTracks(Playlist()));

    [Fact]
    public void APlaylistWithoutReadCannotBeReadAiredOrRefreshed() =>
        Assert.False(PlaylistRules.CanReadTracks(Playlist(permissions: [PlaylistPermission.Edit])));

    [Fact]
    public void AHiddenMixIsHiddenBeforeItIsAMix()
    {
        var groups = PlaylistRules.Group([Playlist(), Playlist(made: true), Playlist(hidden: true, made: true)]);

        Assert.Single(groups.Chosen);
        Assert.Single(groups.MadeByProvider);
        Assert.Single(groups.Hidden);
    }

    [Theory]
    [InlineData(88L, 88L, "88 records")]
    [InlineData(212L, 180L, "212 records · 180 in the library")]
    [InlineData(1L, 1L, "1 record")]
    public void HoldingSaysHowMuchIsInTheLibraryOnlyWhenNotAll(long records, long held, string expected) =>
        Assert.Equal(expected, PlaylistRules.Holding(records, held));

    [Fact]
    public void AnExportedFileIsSentAsAFile()
    {
        var json = """{"format":"deadair.playlist/1","takenAt":"2026-09-29T00:00:00Z","name":"Sunday","tracks":[{"title":"Roads","artists":["Portishead"]}]}""";

        var source = PlaylistRules.FromFile("sunday.json", Encoding.UTF8.GetBytes(json));

        Assert.Null(source.Problem);
        Assert.Equal("Sunday", source.Input?.File?.Name);
    }

    [Fact]
    public void AnythingElseIsSentAsTextWithItsName()
    {
        var source = PlaylistRules.FromFile("mix.m3u", Encoding.UTF8.GetBytes("#EXTM3U\nPortishead - Roads"));

        Assert.Equal("mix.m3u", source.Input?.FileName);
        Assert.StartsWith("#EXTM3U", source.Input?.Text, StringComparison.Ordinal);
    }

    [Fact]
    public void AJsonFileThatDoesNotParseIsSaidHere()
    {
        var source = PlaylistRules.FromFile("broken.json", Encoding.UTF8.GetBytes("{ not json"));

        Assert.Null(source.Input);
        Assert.Contains("broken.json", source.Problem, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("attachment; filename=\"late-and-loud.json\"", "Late and loud", "late-and-loud.json")]
    [InlineData(null, "Late / loud", "Late - loud.json")]
    public void AnExportIsOfferedTheStationsOwnNameOrTheName(string? header, string name, string expected) =>
        Assert.Equal(expected, PlaylistRules.ExportName(header, name));

    [Fact]
    public void APreviewSaysWhatIsHeldAndWhatWillBeLookedUp()
    {
        var plan = new PlaylistImportPlan { Name = "x", Matched = 3, ToAdd = 1, ToLookUp = 1, Skipped = 0, Entries = [], Notices = [] };

        Assert.Equal("3 records are in the library, and 2 are not: the station looks them up once the playlist is made.", PlaylistRules.Plan(plan));
    }
}
