using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class FileSettingsStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"deadair-{Guid.NewGuid():N}");

    [Fact]
    public async Task RemembersWhatWasSaved()
    {
        using var store = new FileSettingsStore(_directory);

        await store.SaveAsync(
            new DesktopSettings { Station = "https://radio.example.com", Appearance = Appearance.Dark },
            TestContext.Current.CancellationToken);

        using var reopened = new FileSettingsStore(_directory);
        await reopened.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Equal("https://radio.example.com", reopened.Current.Station);
        Assert.Equal(Appearance.Dark, reopened.Current.Appearance);
    }

    [Fact]
    public async Task WritesTheAppearanceAsAName()
    {
        // The bug this test exists for, found by running the app rather than by reading it: without a
        // string converter the appearance is written as a number, a hand-written file naming it
        // fails to parse, the store's deliberate tolerance of a bad file swallows it, and the app
        // starts as though nobody had ever configured it. The station address goes with it.
        using var store = new FileSettingsStore(_directory);

        await store.SaveAsync(new DesktopSettings { Appearance = Appearance.Light }, TestContext.Current.CancellationToken);

        var text = await File.ReadAllTextAsync(
            Path.Combine(_directory, "settings.json"),
            TestContext.Current.CancellationToken);

        Assert.Contains("\"Light\"", text, StringComparison.Ordinal);
        Assert.DoesNotContain("\"appearance\": 1", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ReadsAFileSomebodyWroteByHand()
    {
        Directory.CreateDirectory(_directory);
        await File.WriteAllTextAsync(
            Path.Combine(_directory, "settings.json"),
            """{"station":"https://radio.example.com","stationName":"Deadair","format":"flac","appearance":"Dark","volume":0.4}""",
            TestContext.Current.CancellationToken);

        using var store = new FileSettingsStore(_directory);
        await store.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Equal("https://radio.example.com", store.Current.Station);
        Assert.Equal(NowPlayingMountFormat.Flac, store.Current.Format);
        Assert.Equal(Appearance.Dark, store.Current.Appearance);
        Assert.Equal(0.4, store.Current.Volume);
    }

    [Fact]
    public async Task ReadsAFileFromBeforeTheConsolesWentAwayAsFollowingTheSystem()
    {
        // `theme` named one of three consoles and the key is simply gone. Nothing migrates it: the
        // three had no light-or-dark answer between them, and somebody who never went looking for
        // this setting wants the system's, which is what an absent key already means. The station
        // address and the format, which they DID choose, survive.
        Directory.CreateDirectory(_directory);
        await File.WriteAllTextAsync(
            Path.Combine(_directory, "settings.json"),
            """{"station":"https://radio.example.com","format":"flac","theme":"Neon","volume":0.4}""",
            TestContext.Current.CancellationToken);

        using var store = new FileSettingsStore(_directory);
        await store.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Equal(Appearance.System, store.Current.Appearance);
        Assert.Equal("https://radio.example.com", store.Current.Station);
        Assert.Equal(NowPlayingMountFormat.Flac, store.Current.Format);
    }

    [Fact]
    public async Task StartsCleanWhenTheFileIsRubbishRatherThanRefusingToStart()
    {
        // Worst case is somebody retyping a station address. Refusing to start would be worse, and
        // this is deliberate rather than lazy — which is exactly why the test above exists to stop it
        // hiding an ordinary bug.
        Directory.CreateDirectory(_directory);
        await File.WriteAllTextAsync(
            Path.Combine(_directory, "settings.json"),
            "{ this is not json",
            TestContext.Current.CancellationToken);

        using var store = new FileSettingsStore(_directory);
        await store.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Null(store.Current.Station);
        Assert.Equal(Appearance.System, store.Current.Appearance);
    }

    [Fact]
    public async Task HasNoPreferencesBeforeAnythingIsSaved()
    {
        using var store = new FileSettingsStore(_directory);
        await store.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Null(store.Current.Station);
    }

    /// <summary>
    /// A file from before plugins existed is an install with no plugins, not a broken one. Every
    /// settings file on disk today is one of these.
    /// </summary>
    [Fact]
    public async Task AFileFromBeforeTheseKeysExistedMeansThisMacAndNoPlugins()
    {
        Directory.CreateDirectory(_directory);
        await File.WriteAllTextAsync(
            Path.Combine(_directory, "settings.json"),
            """{"station":"https://radio.example.com","appearance":"Dark","volume":0.4}""",
            TestContext.Current.CancellationToken);

        using var store = new FileSettingsStore(_directory);
        await store.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Null(store.Current.Output);
        Assert.Empty(store.Current.Plugins);
    }

    [Fact]
    public async Task RemembersTheDeviceSomebodyChose()
    {
        using var store = new FileSettingsStore(_directory);

        await store.UpdateAsync(
            settings => settings with
            {
                Output = new OutputMemory
                {
                    PluginId = "deadair.bluos",
                    DeviceId = "90:56:82:0e:1b:00",
                    Name = "Living Room",
                    Address = "10.0.1.36:11000",
                },
            },
            TestContext.Current.CancellationToken);

        using var reopened = new FileSettingsStore(_directory);
        await reopened.LoadAsync(TestContext.Current.CancellationToken);

        var output = reopened.Current.Output;
        Assert.NotNull(output);
        Assert.Equal("deadair.bluos", output.PluginId);
        Assert.Equal("90:56:82:0e:1b:00", output.DeviceId);
        Assert.Equal("Living Room", output.Name);
        Assert.Equal("10.0.1.36:11000", output.Address);
    }

    /// <summary>
    /// A plugin's values are strings whatever the field's type, because every layer of this
    /// station's configuration is text: an on/off setting travels as the word and a number as its
    /// digits. A JSON boolean here would be a shape nothing else in the tree stores.
    /// </summary>
    [Fact]
    public async Task APluginsPreferencesAreStrings()
    {
        using var store = new FileSettingsStore(_directory);

        await store.UpdateAsync(
            settings => settings.WithPlugin("deadair.bluos", new PluginSettings
            {
                Enabled = true,
                Config = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["discover"] = "true",
                    ["players"] = "10.0.1.36",
                },
            }),
            TestContext.Current.CancellationToken);

        var text = await File.ReadAllTextAsync(
            Path.Combine(_directory, "settings.json"),
            TestContext.Current.CancellationToken);

        Assert.Contains("\"discover\": \"true\"", text, StringComparison.Ordinal);

        using var reopened = new FileSettingsStore(_directory);
        await reopened.LoadAsync(TestContext.Current.CancellationToken);

        var plugin = reopened.Current.Plugins["deadair.bluos"];
        Assert.True(plugin.Enabled);
        Assert.Equal("true", plugin.Config["discover"]);
        Assert.Equal("10.0.1.36", plugin.Config["players"]);
    }

    [Fact]
    public async Task WritingOnePluginLeavesTheOthersAlone()
    {
        using var store = new FileSettingsStore(_directory);

        await store.UpdateAsync(
            settings => settings.WithPlugin("deadair.bluos", new PluginSettings { Enabled = true }),
            TestContext.Current.CancellationToken);
        await store.UpdateAsync(
            settings => settings.WithPlugin("deadair.sonos", new PluginSettings { Enabled = false }),
            TestContext.Current.CancellationToken);

        Assert.True(store.Current.Plugins["deadair.bluos"].Enabled);
        Assert.False(store.Current.Plugins["deadair.sonos"].Enabled);
    }

    /// <summary>
    /// The reason <c>UpdateAsync</c> exists.
    ///
    /// Reading <c>Current</c>, changing it and saving is a read-modify-write with a gap in the
    /// middle, and it was safe only for as long as every caller happened to be on the UI thread. A
    /// plugin saving its configuration from a background thread is a writer that is not, and what it
    /// costs is somebody's volume change or appearance reverting for no reason anybody can
    /// reproduce. The change runs inside the lock, so it sees the last write rather than whatever
    /// was current when the caller decided to write.
    /// </summary>
    [Fact]
    public async Task TwoChangesAtOnceBothSurvive()
    {
        using var store = new FileSettingsStore(_directory);

        var volume = Task.Run(
            () => store.UpdateAsync(settings => settings with { Volume = 0.25 }),
            TestContext.Current.CancellationToken);
        var appearance = Task.Run(
            () => store.UpdateAsync(settings => settings with { Appearance = Appearance.Light }),
            TestContext.Current.CancellationToken);

        await Task.WhenAll(volume, appearance);

        using var reopened = new FileSettingsStore(_directory);
        await reopened.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Equal(0.25, reopened.Current.Volume);
        Assert.Equal(Appearance.Light, reopened.Current.Appearance);
    }

    /// <summary>
    /// A subscriber that writes settings back from its own handler must not deadlock against the
    /// write that told it, which is why the event is raised outside the lock.
    /// </summary>
    [Fact]
    public async Task AListenerMayWriteBackFromItsOwnHandler()
    {
        using var store = new FileSettingsStore(_directory);
        var written = false;

        store.Changed += _ =>
        {
            if (written)
            {
                return;
            }

            written = true;
            store.UpdateAsync(settings => settings with { Volume = 0.1 }).GetAwaiter().GetResult();
        };

        await store.UpdateAsync(
            settings => settings with { Appearance = Appearance.Dark },
            TestContext.Current.CancellationToken)
            .WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);

        Assert.Equal(0.1, store.Current.Volume);
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }

        GC.SuppressFinalize(this);
    }
}
