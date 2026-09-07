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
            new DesktopSettings { Station = "https://radio.example.com", Theme = ThemeId.Neon },
            TestContext.Current.CancellationToken);

        using var reopened = new FileSettingsStore(_directory);
        await reopened.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Equal("https://radio.example.com", reopened.Current.Station);
        Assert.Equal(ThemeId.Neon, reopened.Current.Theme);
    }

    [Fact]
    public async Task WritesTheThemeAsAName()
    {
        // The bug this test exists for, found by running the app rather than by reading it: without a
        // string converter the theme is written as a number, a hand-written file naming "Carbon"
        // fails to parse, the store's deliberate tolerance of a bad file swallows it, and the app
        // starts as though nobody had ever configured it. The station address goes with it.
        using var store = new FileSettingsStore(_directory);

        await store.SaveAsync(new DesktopSettings { Theme = ThemeId.White }, TestContext.Current.CancellationToken);

        var text = await File.ReadAllTextAsync(
            Path.Combine(_directory, "settings.json"),
            TestContext.Current.CancellationToken);

        Assert.Contains("\"White\"", text, StringComparison.Ordinal);
        Assert.DoesNotContain("\"theme\": 1", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ReadsAFileSomebodyWroteByHand()
    {
        Directory.CreateDirectory(_directory);
        await File.WriteAllTextAsync(
            Path.Combine(_directory, "settings.json"),
            """{"station":"https://radio.example.com","stationName":"Deadair","format":"flac","theme":"Neon","volume":0.4}""",
            TestContext.Current.CancellationToken);

        using var store = new FileSettingsStore(_directory);
        await store.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Equal("https://radio.example.com", store.Current.Station);
        Assert.Equal(NowPlayingMountFormat.Flac, store.Current.Format);
        Assert.Equal(ThemeId.Neon, store.Current.Theme);
        Assert.Equal(0.4, store.Current.Volume);
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
        Assert.Equal(ThemeId.Carbon, store.Current.Theme);
    }

    [Fact]
    public async Task HasNoPreferencesBeforeAnythingIsSaved()
    {
        using var store = new FileSettingsStore(_directory);
        await store.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Null(store.Current.Station);
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
