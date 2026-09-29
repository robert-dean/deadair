using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The station's plugins as a list by role, and the addresses and names their pages hand somebody.
/// </summary>
/// <remarks>
/// A plugin of a kind nobody has a word for yet must still be listed, or installing one would look
/// like it failed. The callback address has to be the console's own, character for character, because
/// that is what gets registered with a provider and a provider compares it exactly. And a saved log is
/// offered under the name the station asked for, cut to a name: a header is not a place a path should
/// come from.
/// </remarks>
public class StationPluginsTests
{
    private static PluginSummary Plugin(string name, params string[] capabilities) => new()
    {
        Id = $"test.{name.ToLowerInvariant()}",
        Name = name,
        Version = "1.0.0",
        Status = PluginStatus.Active,
        Origin = PluginOrigin.Bundled,
        Enabled = true,
        Capabilities = [.. capabilities],
        ConfigFields = [],
        SecretsConfigured = [],
    };

    [Fact]
    public void APluginIsListedOnceUnderTheFirstRoleAnyOfItsCapabilitiesNames()
    {
        var groups = PluginRoles.Group([Plugin("Spotify", "scrobble", "catalog", "stream")]);

        var group = Assert.Single(groups);
        Assert.Equal("Music sources", group.Role.Title);
    }

    [Fact]
    public void APluginOfAKindNobodyHasAWordForIsListedUnderOther_RatherThanDropped()
    {
        var groups = PluginRoles.Group([Plugin("Telepathy", "telepathy"), Plugin("Kokoro", "speech")]);

        Assert.Equal(["Voice", "Other"], groups.Select(group => group.Role.Title));
        Assert.Equal("telepathy", PluginRoles.Label("telepathy"));
    }

    [Fact]
    public void PluginsUnderARoleAreAlphabetical()
    {
        var groups = PluginRoles.Group([Plugin("Kokoro", "speech"), Plugin("Chatterbox", "speech")]);

        Assert.Equal(["Chatterbox", "Kokoro"], groups[0].Plugins.Select(plugin => plugin.Name));
    }

    [Theory]
    [InlineData(PluginStatus.Failed, true)]
    [InlineData(PluginStatus.Misconfigured, true)]
    [InlineData(PluginStatus.Disabled, false)]
    [InlineData(PluginStatus.Discovered, false)]
    public void OnlyABrokenPluginNeedsAttention(PluginStatus status, bool expected) => Assert.Equal(expected, PluginRoles.NeedsAttention(status));

    [Fact]
    public void AFailedPluginIsNotDrawnAsAMisconfiguredOne()
    {
        // Two urgent states that want different things done, and a fault must never read as on air.
        Assert.NotEqual(PluginStatusWords.Tone(PluginStatus.Failed), PluginStatusWords.Tone(PluginStatus.Misconfigured));
        Assert.Equal(StatusTone.Fault, PluginStatusWords.Tone(PluginStatus.Misconfigured));
    }

    [Fact]
    public void ARowShowsTheFirstLineOfADescription() => Assert.Equal("First.", PluginRoles.FirstLine("First.\nSecond."));

    [Fact]
    public void TheCallbackIsTheConsolesOwnPageOnTheStationsOrigin()
    {
        Assert.True(StationUrl.TryParse("https://radio.example.com/", out var station));

        Assert.Equal(
            "https://radio.example.com/plugins/deadair.spotify/oauth/callback",
            PluginLinks.OAuthCallback(station, "deadair.spotify").AbsoluteUri);
    }

    [Theory]
    [InlineData(null, "fallback.log")]
    [InlineData("attachment", "fallback.log")]
    [InlineData("attachment; filename=\"deadair.spotify-2026-09-29.log\"", "deadair.spotify-2026-09-29.log")]
    [InlineData("attachment; filename=plain.log; filename*=UTF-8''caf%C3%A9.log", "café.log")]
    [InlineData("attachment; filename=\"../../etc/passwd\"", "passwd")]
    public void ADownloadIsSavedUnderTheNameItAskedFor_CutToAName(string? header, string expected) =>
        Assert.Equal(expected, PluginLinks.FileName(header, "fallback.log"));

    [Fact]
    public void AFetcherThatIsNotAnsweringIsNotReportedAsUnauthorized()
    {
        var (label, tone) = PluginLinks.Fetcher(new FetcherAuthorization { Configured = true, Reachable = false, Authorized = false, Session = false });

        Assert.Equal("Not answering", label);
        Assert.Equal(StatusTone.Standby, tone);
    }

    [Fact]
    public void TheFirstEnableSaysWhatTrustingAPluginMeans_AndNamesIt()
    {
        var said = StationPluginSwitch.Trust("Spotify", ["catalog", "oauth"]);

        Assert.Contains("Spotify", said, StringComparison.Ordinal);
        Assert.Contains("trusted code", said, StringComparison.Ordinal);
        Assert.Contains("Library, Sign-in", said, StringComparison.Ordinal);
    }

    [Fact]
    public void ALogLineThatIsNotATimeIsShownAsItCame()
    {
        var line = StationPluginViewModel.Line(new PluginLogEntry { Ts = "soon", Level = PluginLogLevel.Error, Text = "boom" });

        Assert.Equal("soon", line.At);
        Assert.Equal("ERROR", line.Level);
    }
}
