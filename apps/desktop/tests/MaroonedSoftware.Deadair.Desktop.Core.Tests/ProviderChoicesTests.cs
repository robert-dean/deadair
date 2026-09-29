using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Which plugin does a job, and what is saved to say so.
/// </summary>
/// <remarks>
/// The choice is saved through settings, under a key the station names, in two shapes that are easy
/// to get backwards: a pick is a plugin id as text, an order is TEXT holding a JSON array. And a plugin
/// that is named and cannot answer must still be among the choices, or the box draws as though
/// nothing were set when in fact nothing is doing the job.
/// </remarks>
public class ProviderChoicesTests
{
    private static ProviderCandidate Candidate(string id, long? position, bool inUse = false) =>
        new() { PluginId = id, Name = id.ToUpperInvariant(), Status = PluginStatus.Active, Enabled = true, Position = position, InUse = inUse, Listed = position is not null };

    private static ProviderCapabilityState State(string configured, IReadOnlyList<string> stale, params ProviderCandidate[] candidates) => new()
    {
        Capability = "speech",
        Mode = ProviderMode.One,
        SettingKey = "providers.speech",
        Configured = configured,
        Stale = [.. stale],
        Unanswered = false,
        Candidates = [.. candidates],
    };

    [Fact]
    public void AutomaticSaysWhichPluginItHasChosen_WhileNothingIsNamed()
    {
        var options = ProviderChoices.PickOptions(State(string.Empty, [], Candidate("a", 0, inUse: true), Candidate("b", 1)));

        Assert.Equal(["Automatic (currently A)", "A", "B"], options.Select(option => option.Label));
        Assert.Equal(ProviderChoices.Automatic, options[0].Value);
    }

    [Fact]
    public void ANamedPluginThatIsNotRunningIsStillAChoice_SoTheBoxShowsWhatIsStored()
    {
        var options = ProviderChoices.PickOptions(State("b", [], Candidate("a", 0, inUse: true), Candidate("b", null)));

        Assert.Contains(options, option => option is { Value: "b", Label: "B (not running)" });
        Assert.Equal("Automatic", options[0].Label);
    }

    [Fact]
    public void ANamedPluginThatIsNotInstalledIsStillAChoice()
    {
        var options = ProviderChoices.PickOptions(State("gone", ["gone"], Candidate("a", 0, inUse: true)));

        Assert.Contains(options, option => option is { Value: "gone", Label: "gone (not installed)" });
    }

    [Theory]
    [InlineData(0, -1)]
    [InlineData(2, 1)]
    [InlineData(1, 0)]
    public void AMoveWithNowhereToGoIsNothing(int index, int by) => Assert.Null(ProviderChoices.Move(["a", "b", "c"], index, by));

    [Fact]
    public void AMoveSwapsNeighbours() => Assert.Equal(["b", "a", "c"], ProviderChoices.Move(["a", "b", "c"], 1, -1));

    [Fact]
    public void AnOrderIsSavedAsTextHoldingAJsonArrayOfSources()
    {
        var saved = ProviderChoices.Order(["deadair.lastfm", "deadair.deezer"]);

        Assert.Equal(JsonValueKind.String, saved.ValueKind);
        Assert.Equal("""[{"source":"deadair.lastfm"},{"source":"deadair.deezer"}]""", saved.GetString());
    }

    [Fact]
    public void APickIsSavedAsThePluginIdAsText() => Assert.Equal("deadair.kokoro", ProviderChoices.Pick("deadair.kokoro").GetString());

    [Fact]
    public void TheAskingOrderIsTheStationsPositions_AndTheRestAreIdle()
    {
        var state = State(string.Empty, [], Candidate("c", null), Candidate("b", 1), Candidate("a", 0));

        Assert.Equal(["a", "b"], ProviderChoices.Asked(state).Select(candidate => candidate.PluginId));
        Assert.Equal(["c"], ProviderChoices.Idle(state).Select(candidate => candidate.PluginId));
    }

    [Fact]
    public void AJobThisAppHasNoWordsForIsStillDrawn_UnderItsOwnName()
    {
        var (title, _, only) = ProviderChoices.Words("telepathy", "Uri");

        Assert.Equal("telepathy", title);
        Assert.Contains("Uri", only, StringComparison.Ordinal);
    }
}
