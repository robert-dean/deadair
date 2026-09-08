using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Starting plugins, stopping them, and reconfiguring them.
///
/// Against the fixture plugin next door, because what these assert is what happens to a real
/// instance: that a disabled one is never built, that saving configuration ends one and starts
/// another, and that a plugin which fails to start says why instead of taking the app with it.
/// </summary>
[Collection(nameof(PluginManagerTests))]
[CollectionDefinition(nameof(PluginManagerTests), DisableParallelization = true)]
public sealed class PluginManagerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"deadair-manager-{Guid.NewGuid():N}");
    private readonly FileSettingsStore _settings;

    public PluginManagerTests()
    {
        Directory.CreateDirectory(_root);
        _settings = new FileSettingsStore(Path.Combine(_root, "settings"));
    }

    /// <summary>
    /// Every line the fixture wrote, in order.
    ///
    /// It writes beside its own assembly, and every test installs its own copy into its own
    /// directory, so this is one diary per test without anything process-wide to share by accident.
    /// The plugin's statics are not reachable from here: it is loaded into a context of its own, and
    /// this project deliberately does not reference it.
    /// </summary>
    private IReadOnlyList<string> Diary =>
        Directory.Exists(_root)
            ? [.. Directory.GetFiles(_root, "diary.txt", SearchOption.AllDirectories).OrderBy(path => path, StringComparer.Ordinal).SelectMany(File.ReadAllLines)]
            : [];

    private int Count(string line) => Diary.Count(written => written == line);

    private string? ConfigSeen(string key) =>
        Diary.LastOrDefault(line => line.StartsWith($"config {key}=", StringComparison.Ordinal))?.Split('=', 2)[1];

    /// <summary>
    /// Points the manifest at another class in the fixture, and stops claiming an output target with
    /// it: those classes are about starting and failing rather than about playing anything, and a
    /// capability they do not implement would be refused at load before they could fail their own
    /// way. The made-up capability that replaces it is also the check that an unfamiliar one loads.
    /// </summary>
    private static string EntryIs(string type, string manifest) => manifest
        .Replace(".GoodPlugin", "." + type, StringComparison.Ordinal)
        .Replace("""["output-target"]""", """["something-this-app-has-never-heard-of"]""", StringComparison.Ordinal);

    /// <summary>
    /// A plugin shipped inside the app is on, because shipping it is the decision to have it: an
    /// operator who never opens the settings page should still be able to play on their speaker.
    /// </summary>
    [Fact]
    public async Task ABundledPluginRunsWithoutAnybodySayingSo()
    {
        Install(PluginOrigin.Bundled);
        await using var manager = Manager();

        await manager.StartAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PluginStatus.Active, Assert.Single(manager.Records).Status);
        Assert.Equal(1, Count("init deadair.fixture"));
    }

    /// <summary>
    /// One somebody dropped in themselves is not. Code that arrived without being asked for should
    /// not start itself, and a plugin that is listed and off is a question rather than a surprise.
    /// </summary>
    [Fact]
    public async Task APluginSomebodyDroppedInIsListedButNotRun()
    {
        Install(PluginOrigin.User);
        await using var manager = Manager();

        await manager.StartAsync(TestContext.Current.CancellationToken);

        var record = Assert.Single(manager.Records);
        Assert.Equal(PluginStatus.Disabled, record.Status);
        Assert.Null(record.Instance);
        Assert.Empty(Diary);

        // Still drawable: a plugin nobody has switched on should still show its name and its
        // settings, or there is nothing to decide from.
        Assert.NotNull(record.Manifest);
        Assert.Equal("A plugin that exists to be loaded", record.DisplayName);
    }

    [Fact]
    public async Task SwitchingOneOnStartsIt_AndSwitchingItOffEndsIt()
    {
        Install(PluginOrigin.User);
        await using var manager = Manager();
        await manager.StartAsync(TestContext.Current.CancellationToken);

        await manager.SetEnabledAsync("deadair.fixture", enabled: true, TestContext.Current.CancellationToken);

        Assert.Equal(PluginStatus.Active, Assert.Single(manager.Records).Status);
        Assert.Equal(1, Count("init deadair.fixture"));

        await manager.SetEnabledAsync("deadair.fixture", enabled: false, TestContext.Current.CancellationToken);

        Assert.Equal(PluginStatus.Disabled, Assert.Single(manager.Records).Status);
        Assert.Equal(1, Count("dispose"));
        Assert.Equal(1, Count("shutdown"));
    }

    [Fact]
    public async Task WhatWasSwitchedOnIsStillOnNextTime()
    {
        Install(PluginOrigin.User);

        await using (var manager = Manager())
        {
            await manager.StartAsync(TestContext.Current.CancellationToken);
            await manager.SetEnabledAsync("deadair.fixture", enabled: true, TestContext.Current.CancellationToken);
        }

        using var reopened = new FileSettingsStore(Path.Combine(_root, "settings"));
        await reopened.LoadAsync(TestContext.Current.CancellationToken);
        await using var again = new PluginManager(new PluginLoader(Directories()), reopened, new FakeTimeProvider());

        await again.StartAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PluginStatus.Active, Assert.Single(again.Records).Status);
    }

    /// <summary>
    /// A plugin reads its settings once, when it starts, which is what makes an instance a thing
    /// with a configuration rather than a thing that keeps checking one. So the only honest way to
    /// apply a change is to end it and start again.
    /// </summary>
    [Fact]
    public async Task SavingConfigurationStartsThePluginAgainWithIt()
    {
        Install(PluginOrigin.Bundled);
        await using var manager = Manager();
        await manager.StartAsync(TestContext.Current.CancellationToken);

        Assert.Equal("hello", ConfigSeen("greeting"));

        await manager.SaveConfigAsync(
            "deadair.fixture",
            new Dictionary<string, string>(StringComparer.Ordinal) { ["greeting"] = "good evening" },
            TestContext.Current.CancellationToken);

        Assert.Equal(2, Count("init deadair.fixture"));
        Assert.Equal(1, Count("dispose"));
        Assert.Equal("good evening", ConfigSeen("greeting"));
        Assert.Equal(PluginStatus.Active, Assert.Single(manager.Records).Status);
    }

    /// <summary>
    /// Saving a bundled plugin's settings must not switch it off, which is what happened while an
    /// absent entry in the file was read as "disabled" rather than as "nobody has said". The plugin
    /// went quiet the first time anybody touched its configuration, in the same breath as a change
    /// they did mean.
    /// </summary>
    [Fact]
    public async Task SavingSettingsDoesNotQuietlySwitchABundledPluginOff()
    {
        Install(PluginOrigin.Bundled);
        await using var manager = Manager();
        await manager.StartAsync(TestContext.Current.CancellationToken);

        await manager.SaveConfigAsync(
            "deadair.fixture",
            new Dictionary<string, string>(StringComparer.Ordinal) { ["greeting"] = "still here" },
            TestContext.Current.CancellationToken);

        Assert.Equal(PluginStatus.Active, Assert.Single(manager.Records).Status);
        Assert.True(_settings.Current.Plugins["deadair.fixture"].Enabled);
    }

    /// <summary>
    /// A declared default fills a field nobody set, and a field with neither a value nor a default is
    /// ABSENT rather than empty, so a plugin can tell "not set" from "set to nothing".
    /// </summary>
    [Fact]
    public async Task AFieldWithNoValueAndNoDefaultIsNotThereAtAll()
    {
        Install(PluginOrigin.Bundled, manifest => manifest.Replace(
            """{ "key": "loud", "label": "Loud", "type": "boolean", "default": "false" }""",
            """{ "key": "loud", "label": "Loud", "type": "boolean" }""",
            StringComparison.Ordinal));
        await using var manager = Manager();

        await manager.StartAsync(TestContext.Current.CancellationToken);

        Assert.Equal("hello", ConfigSeen("greeting"));
        Assert.Null(ConfigSeen("loud"));
    }

    /// <summary>
    /// Not filled in is a different situation from broken, and it wants a different sentence and a
    /// different button.
    /// </summary>
    [Fact]
    public async Task APluginMissingSomethingItNeedsIsMisconfiguredRatherThanFailed()
    {
        Install(PluginOrigin.Bundled, manifest => manifest.Replace(
            """{ "key": "greeting", "label": "Greeting", "type": "string", "default": "hello" }""",
            """{ "key": "greeting", "label": "Greeting", "type": "string", "required": true }""",
            StringComparison.Ordinal));
        await using var manager = Manager();

        await manager.StartAsync(TestContext.Current.CancellationToken);

        var record = Assert.Single(manager.Records);
        Assert.Equal(PluginStatus.Misconfigured, record.Status);
        Assert.Contains("Greeting", record.Error, StringComparison.Ordinal);
        Assert.Empty(Diary);

        await manager.SaveConfigAsync(
            "deadair.fixture",
            new Dictionary<string, string>(StringComparer.Ordinal) { ["greeting"] = "there" },
            TestContext.Current.CancellationToken);

        Assert.Equal(PluginStatus.Active, Assert.Single(manager.Records).Status);
    }

    /// <summary>
    /// The message the plugin wrote reaches the operator, because it is the only part of this that
    /// says anything about their network rather than about this app.
    /// </summary>
    [Fact]
    public async Task APluginThatFailsToStartSaysWhy_AndTheAppCarriesOn()
    {
        Install(PluginOrigin.Bundled, manifest => EntryIs("ThrowsOnInitPlugin", manifest));
        await using var manager = Manager();

        await manager.StartAsync(TestContext.Current.CancellationToken);

        var record = Assert.Single(manager.Records);
        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Equal("there is no speaker at that address", record.Error);
        Assert.Null(record.Instance);
    }

    /// <summary>
    /// A plugin that never returns from start is not malice: it is a discovery waiting for a device
    /// on a network where nothing will answer. Bounding it is what stops the app never finishing
    /// startup because of a plugin nobody is currently using.
    /// </summary>
    [Fact]
    public async Task APluginThatNeverFinishesStartingIsGivenUpOn()
    {
        Install(PluginOrigin.Bundled, manifest => EntryIs("HangsOnInitPlugin", manifest));

        // A second rather than the real thirty. What is under test is that the deadline exists and
        // that giving up says so, not how long it is.
        await using var manager = Manager(TimeSpan.FromSeconds(1));

        await manager.StartAsync(TestContext.Current.CancellationToken);

        var record = Assert.Single(manager.Records);
        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Contains("starting", record.Error, StringComparison.Ordinal);
    }

    /// <summary>
    /// How everything else asks a plugin for anything: by what it can do, so nothing outside the
    /// manager has to know which plugins exist.
    /// </summary>
    [Fact]
    public async Task OnlyRunningPluginsAnswerACapability()
    {
        Install(PluginOrigin.User);
        await using var manager = Manager();
        await manager.StartAsync(TestContext.Current.CancellationToken);

        Assert.Empty(manager.Capabilities<IOutputTargetProvider>());

        await manager.SetEnabledAsync("deadair.fixture", enabled: true, TestContext.Current.CancellationToken);

        var provider = Assert.Single(manager.Capabilities<IOutputTargetProvider>());
        var devices = await provider.DiscoverAsync(TestContext.Current.CancellationToken);
        Assert.Equal("fixture-1", Assert.Single(devices).Id);
    }

    [Fact]
    public async Task WhatAPluginSaidIsKeptWhereSomebodyCanReadIt()
    {
        Install(PluginOrigin.Bundled);
        await using var manager = Manager();

        await manager.StartAsync(TestContext.Current.CancellationToken);

        var line = Assert.Single(manager.LogFor("deadair.fixture"));
        Assert.Equal("the fixture plugin started", line.Message);
    }

    /// <summary>
    /// Closing the app tells a plugin to let go before anything is taken away from it. A device
    /// plugin that was not told would leave a speaker streaming, which is a listener the station
    /// keeps counting and nothing left to stop it.
    /// </summary>
    [Fact]
    public async Task ClosingTheAppTellsEveryPluginToLetGo()
    {
        Install(PluginOrigin.Bundled);
        var manager = Manager();
        await manager.StartAsync(TestContext.Current.CancellationToken);

        await manager.DisposeAsync();

        Assert.Equal(1, Count("shutdown"));
        Assert.Equal(1, Count("dispose"));
    }

    [Fact]
    public async Task OneQuarantinedPluginDoesNotStopTheOthersRunning()
    {
        Install(PluginOrigin.Bundled, manifest => EntryIs("NotAPlugin", manifest), folder: "a-broken-one");
        Install(PluginOrigin.Bundled, manifest => manifest.Replace("deadair.fixture", "deadair.second", StringComparison.Ordinal), folder: "b-working-one");
        await using var manager = Manager();

        await manager.StartAsync(TestContext.Current.CancellationToken);

        Assert.Equal(PluginStatus.Failed, manager.Records[0].Status);
        Assert.Equal(PluginStatus.Active, manager.Records[1].Status);
    }

    private PluginManager Manager(TimeSpan? startDeadline = null) =>
        new(new PluginLoader(Directories()), _settings, new FakeTimeProvider(), startDeadline);

    private PluginDirectories Directories() =>
        new(Path.Combine(_root, "bundled"), Path.Combine(_root, "user"));

    private string Install(PluginOrigin origin, Func<string, string>? manifest = null, string folder = "deadair.fixture")
    {
        var directory = Path.Combine(_root, origin == PluginOrigin.Bundled ? "bundled" : "user", folder);
        Directory.CreateDirectory(directory);

        var source = Path.Combine(AppContext.BaseDirectory, "plugins", "deadair.fixture");

        foreach (var file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(directory, Path.GetFileName(file)), overwrite: true);
        }

        if (manifest is not null)
        {
            var path = Path.Combine(directory, "plugin.json");
            File.WriteAllText(path, manifest(File.ReadAllText(path)));
        }

        return directory;
    }

    public void Dispose()
    {
        _settings.Dispose();

        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }
}
