using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Manifest;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What a plugin says about itself, and what the app makes of a manifest somebody typed by hand.
///
/// Every failure here belongs to a file this app did not write, so all of them are values rather
/// than exceptions: one unhandled throw over a stray comma in a plugin nobody has even enabled would
/// take the whole app down at startup.
/// </summary>
public sealed class PluginManifestTests
{
    private const string Good = """
        {
            "id": "deadair.bluos",
            "name": "BluOS players",
            "version": "0.1.0",
            "apiVersion": "^1.0.0",
            "description": "Plays the station on a BluOS speaker.",
            "capabilities": ["output-target"],
            "entry": {
                "assembly": "MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.dll",
                "type": "MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.BluOsPlugin"
            },
            "configFields": [
                { "key": "discover", "label": "Find players on the network", "type": "boolean", "default": "true" },
                { "key": "players", "label": "Players", "type": "string", "help": "One per line." }
            ]
        }
        """;

    [Fact]
    public void ReadsAManifestAPluginAuthorWouldWrite()
    {
        var reading = PluginManifestReader.Read(Good);

        Assert.True(reading.Ok);
        Assert.Null(reading.Problem);

        var manifest = reading.Manifest;
        Assert.NotNull(manifest);
        Assert.Equal("deadair.bluos", manifest.Id);
        Assert.Equal("^1.0.0", manifest.ApiVersion);
        Assert.Equal("output-target", Assert.Single(manifest.Capabilities));
        Assert.Equal("MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.BluOsPlugin", manifest.Entry.Type);
        Assert.Equal(2, manifest.ConfigFields.Count);
        Assert.Equal(PluginConfigFieldType.Boolean, manifest.ConfigFields[0].Type);
        Assert.Equal("true", manifest.ConfigFields[0].Default);
        Assert.Equal(PluginConfigFieldType.Line, manifest.ConfigFields[1].Type);
    }

    /// <summary>
    /// The wire words are the station's own, so somebody who has written a manifest for the server
    /// writes the same ones here rather than learning a second vocabulary for the same idea.
    /// </summary>
    [Theory]
    [InlineData("string", PluginConfigFieldType.Line)]
    [InlineData("text", PluginConfigFieldType.Text)]
    [InlineData("url", PluginConfigFieldType.Url)]
    [InlineData("number", PluginConfigFieldType.Number)]
    [InlineData("boolean", PluginConfigFieldType.Boolean)]
    [InlineData("note", PluginConfigFieldType.Note)]
    public void AFieldTypeIsNamedTheWayTheStationNamesIt(string wire, PluginConfigFieldType expected)
    {
        var reading = PluginManifestReader.Read(WithField($$"""{ "key": "k", "label": "L", "type": "{{wire}}" }"""));

        Assert.True(reading.Ok, reading.Problem);
        Assert.Equal(expected, reading.Manifest!.ConfigFields[0].Type);
    }

    /// <summary>
    /// A secret has nowhere safe to live yet, so a plugin asking for one is refused with the type
    /// named. Drawing it as a text box would put a password in a JSON file in somebody's home
    /// directory, which is worse than not supporting it.
    /// </summary>
    [Fact]
    public void AFieldTypeThisAppDoesNotDrawIsRefused_AndTheMessageNamesIt()
    {
        var reading = PluginManifestReader.Read(WithField("""{ "key": "token", "label": "Token", "type": "secret" }"""));

        Assert.False(reading.Ok);
        Assert.Contains("secret", reading.Problem, StringComparison.Ordinal);
    }

    [Fact]
    public void GarbageIsAProblemRatherThanAnException()
    {
        var reading = PluginManifestReader.Read("{ not json at all");

        Assert.False(reading.Ok);
        Assert.NotNull(reading.Problem);
    }

    [Fact]
    public void AMissingFileIsAProblemRatherThanAnException()
    {
        var reading = PluginManifestReader.ReadFile(Path.Combine(Path.GetTempPath(), $"no-such-{Guid.NewGuid():N}", "plugin.json"));

        Assert.False(reading.Ok);
        Assert.NotNull(reading.Problem);
    }

    /// <summary>
    /// An unknown MEMBER is ignored while an unknown field TYPE is refused, and the difference is
    /// the point: a member this app has not heard of is something a later contract added and this
    /// one does not need, while a type it cannot draw is a box the operator would never be able to
    /// fill in.
    /// </summary>
    [Fact]
    public void AMemberFromALaterContractIsIgnored()
    {
        var reading = PluginManifestReader.Read(Good.Replace(
            "\"capabilities\": [\"output-target\"],",
            "\"capabilities\": [\"output-target\", \"something-later\"], \"homepage\": \"https://example.com\",",
            StringComparison.Ordinal));

        Assert.True(reading.Ok, reading.Problem);
        Assert.Equal(2, reading.Manifest!.Capabilities.Count);
    }

    [Theory]
    [InlineData("id", "bluos", "reverse-DNS")]
    [InlineData("id", "Deadair.BluOS", "reverse-DNS")]
    [InlineData("version", "one", "version")]
    public void ABadValueIsNamedInTheProblem(string key, string value, string expected)
    {
        var quoted = "\"" + key + "\": ";
        var original = Good.Split('\n').Single(line => line.TrimStart().StartsWith(quoted, StringComparison.Ordinal)).Trim().TrimEnd(',');

        var reading = PluginManifestReader.Read(Good.Replace(original, quoted + "\"" + value + "\"", StringComparison.Ordinal));

        Assert.False(reading.Ok);
        Assert.Contains(expected, reading.Problem, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Every problem at once, because somebody fixing a plugin they wrote should not have to run the
    /// app five times to find five typos.
    /// </summary>
    [Fact]
    public void EverythingWrongIsListedRatherThanTheFirstThing()
    {
        var problems = PluginManifestValidator.Problems(new PluginManifest
        {
            Id = "nope",
            Name = "  ",
            Version = "x",
            ApiVersion = "",
            Entry = new PluginEntryPoint(string.Empty, string.Empty),
        });

        Assert.True(problems.Count >= 6, string.Join("; ", problems));
    }

    /// <summary>
    /// Two fields with one key means the second silently wins in both directions and nothing about
    /// the drawn form would look wrong.
    /// </summary>
    [Fact]
    public void TwoFieldsCannotShareAKey()
    {
        var reading = PluginManifestReader.Read(WithField("""
            { "key": "host", "label": "Host", "type": "string" },
            { "key": "host", "label": "Host again", "type": "string" }
            """));

        Assert.False(reading.Ok);
        Assert.Contains("host", reading.Problem, StringComparison.Ordinal);
    }

    [Fact]
    public void ASelectWithNothingToSelectIsAProblem()
    {
        var reading = PluginManifestReader.Read(WithField("""{ "key": "mode", "label": "Mode", "type": "select" }"""));

        Assert.False(reading.Ok);
        Assert.Contains("mode", reading.Problem, StringComparison.Ordinal);
    }

    /// <summary>
    /// A plugin the host would never ask for anything is worth refusing at the door rather than
    /// listing as installed and inert.
    /// </summary>
    [Fact]
    public void APluginThatDeclaresNoCapabilityIsRefused()
    {
        var reading = PluginManifestReader.Read(Good.Replace(
            "\"capabilities\": [\"output-target\"],",
            "\"capabilities\": [],",
            StringComparison.Ordinal));

        Assert.False(reading.Ok);
        Assert.Contains("capabilities", reading.Problem, StringComparison.Ordinal);
    }

    private static string WithField(string fieldJson) => $$"""
        {
            "id": "deadair.example",
            "name": "Example",
            "version": "0.1.0",
            "apiVersion": "^1.0.0",
            "capabilities": ["output-target"],
            "entry": { "assembly": "Example.dll", "type": "Example.Plugin" },
            "configFields": [ {{fieldJson}} ]
        }
        """;
}
