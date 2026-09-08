using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The places the station can come out of, and getting back to the one somebody chose.
/// </summary>
public sealed class OutputCatalogTests : IDisposable
{
    private static readonly Output Kitchen = new("deadair.bluos", "90:56:82:00:bc:99", "Kitchen", "N130", "10.0.1.36:11000");

    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"deadair-outputs-{Guid.NewGuid():N}");
    private readonly FakeOutputs _plugins = new();
    private readonly OutputSwitch _switch = new(new NullStationPlayer());
    private readonly FileSettingsStore _settings;

    public OutputCatalogTests() => _settings = new FileSettingsStore(_directory);

    /// <summary>
    /// This machine is not a plugin's to supply and cannot go away, so it is always the first row and
    /// is there before any plugin has answered anything.
    /// </summary>
    [Fact]
    public void ThisMachineIsAlwaysThereAndAlwaysFirst()
    {
        var catalog = Catalog();

        Assert.Equal(Output.ThisMac, Assert.Single(catalog.Outputs));
        Assert.Equal(Output.ThisMac, catalog.Active);
    }

    [Fact]
    public async Task LooksForDevicesAndListsThemAfterThisMachine()
    {
        _plugins.Found = [Kitchen];
        var catalog = Catalog();

        await catalog.RescanAsync(TestContext.Current.CancellationToken);

        Assert.Equal([Output.ThisMac, Kitchen], catalog.Outputs);
    }

    [Fact]
    public async Task ChoosingADeviceMovesTheStationAndWritesItDown()
    {
        _plugins.Found = [Kitchen];
        var catalog = Catalog();
        await catalog.RescanAsync(TestContext.Current.CancellationToken);

        var result = await catalog.SelectAsync(Kitchen, Station(), TestContext.Current.CancellationToken);

        Assert.Equal(OutputSelection.Selected, result);
        Assert.Equal(Kitchen, catalog.Active);

        var remembered = _settings.Current.Output;
        Assert.NotNull(remembered);
        Assert.Equal("90:56:82:00:bc:99", remembered.DeviceId);
        Assert.Equal("10.0.1.36:11000", remembered.Address);
    }

    [Fact]
    public async Task ComingBackToThisMachineForgetsTheDevice()
    {
        _plugins.Found = [Kitchen];
        var catalog = Catalog();
        await catalog.RescanAsync(TestContext.Current.CancellationToken);
        await catalog.SelectAsync(Kitchen, Station(), TestContext.Current.CancellationToken);

        await catalog.SelectAsync(Output.ThisMac, Station(), TestContext.Current.CancellationToken);

        Assert.Equal(Output.ThisMac, catalog.Active);
        Assert.Null(_settings.Current.Output);
    }

    [Fact]
    public async Task GoesBackToTheDeviceItWasLastPlayingOn()
    {
        await Remember(Kitchen);
        _plugins.Found = [Kitchen];
        var catalog = Catalog();

        var result = await catalog.RestoreAsync(Station(), TestContext.Current.CancellationToken);

        Assert.Equal(OutputRestore.Restored, result);
        Assert.Equal(Kitchen, catalog.Active);
    }

    /// <summary>
    /// A speaker switched off tonight is on again tomorrow. Forgetting it would make the app's memory
    /// depend on whether anybody happened to open it during the evening.
    /// </summary>
    [Fact]
    public async Task ADeviceThatIsNotThereIsSaidSoAboutAndStillRemembered()
    {
        await Remember(Kitchen);
        _plugins.Found = [];
        var catalog = Catalog();

        var result = await catalog.RestoreAsync(Station(), TestContext.Current.CancellationToken);

        Assert.Equal(OutputRestore.NotFound, result);
        Assert.Equal(Output.ThisMac, catalog.Active);
        Assert.NotNull(_settings.Current.Output);
    }

    /// <summary>
    /// A player given a new lease is the same speaker, and its id is the thing about it that does not
    /// change. Matching on the address alone would lose it every time the router restarted.
    /// </summary>
    [Fact]
    public async Task ADeviceThatMovedIsStillTheSameDevice()
    {
        await Remember(Kitchen);
        _plugins.Found = [Kitchen with { Address = "10.0.1.99:11000" }];
        var catalog = Catalog();

        Assert.Equal(OutputRestore.Restored, await catalog.RestoreAsync(Station(), TestContext.Current.CancellationToken));
        Assert.Equal("10.0.1.99:11000", catalog.Active.Address);
    }

    /// <summary>
    /// A rescan that loses the active device says so and does nothing else. Falling back would start
    /// the Mac's speakers unasked, in a room somebody may have left, and add a second listener to the
    /// station while the first was still being counted.
    /// </summary>
    [Fact]
    public async Task ADeviceVanishingFromAScanDoesNotMoveThePlayback()
    {
        _plugins.Found = [Kitchen];
        var catalog = Catalog();
        await catalog.RescanAsync(TestContext.Current.CancellationToken);
        await catalog.SelectAsync(Kitchen, Station(), TestContext.Current.CancellationToken);

        _plugins.Found = [];
        await catalog.RescanAsync(TestContext.Current.CancellationToken);

        Assert.Equal(Kitchen, catalog.Active);
        Assert.True(catalog.ActiveMissing);
    }

    /// <summary>
    /// Switching a plugin off has to take its device with it, and it is done while the plugin is
    /// still there to stop the speaker properly.
    /// </summary>
    [Fact]
    public async Task LettingGoOfAPluginBringsTheSoundBackHere()
    {
        _plugins.Found = [Kitchen];
        var catalog = Catalog();
        await catalog.RescanAsync(TestContext.Current.CancellationToken);
        await catalog.SelectAsync(Kitchen, Station(), TestContext.Current.CancellationToken);

        await catalog.ReleasePluginAsync("deadair.bluos", TestContext.Current.CancellationToken);

        Assert.Equal(Output.ThisMac, catalog.Active);
        Assert.Equal(Output.ThisMac, Assert.Single(catalog.Outputs));

        // The choice is not forgotten: the operator did not change their mind, the app took the
        // plugin away for a moment.
        Assert.NotNull(_settings.Current.Output);
    }

    /// <summary>
    /// A speaker resolves an address for itself, so a station at localhost is one it cannot see. It
    /// would simply play silence, which is the hardest fault of all to read.
    /// </summary>
    [Theory]
    [InlineData("http://localhost:3000")]
    [InlineData("http://127.0.0.1:3000")]
    public async Task ADeviceIsNotSentToAStationOnlyThisMachineCanSee(string address)
    {
        _plugins.Found = [Kitchen];
        var catalog = Catalog();
        await catalog.RescanAsync(TestContext.Current.CancellationToken);

        Assert.True(StationUrl.TryParse(address, out var local));

        var result = await catalog.SelectAsync(Kitchen, local, TestContext.Current.CancellationToken);

        Assert.Equal(OutputSelection.StationUnreachable, result);
        Assert.Equal(Output.ThisMac, catalog.Active);
    }

    [Fact]
    public async Task ThisMachineIsFineWithAStationOnThisMachine()
    {
        Assert.True(StationUrl.TryParse("http://localhost:3000", out var local));

        var result = await Catalog().SelectAsync(Output.ThisMac, local, TestContext.Current.CancellationToken);

        Assert.Equal(OutputSelection.Selected, result);
    }

    [Fact]
    public async Task ADeviceWhosePluginHasGoneIsReportedRatherThanCrashedOn()
    {
        _plugins.Found = [Kitchen];
        _plugins.Opens = false;
        var catalog = Catalog();
        await catalog.RescanAsync(TestContext.Current.CancellationToken);

        Assert.Equal(OutputSelection.NotFound, await catalog.SelectAsync(Kitchen, Station(), TestContext.Current.CancellationToken));
    }

    public void Dispose()
    {
        _settings.Dispose();
        _switch.DisposeAsync().AsTask().GetAwaiter().GetResult();

        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }

    private OutputCatalog Catalog() => new(_plugins, _switch, _settings);

    private static StationUrl Station()
    {
        Assert.True(StationUrl.TryParse("https://radio.example.com", out var station));
        return station;
    }

    private Task<DesktopSettings> Remember(Output output) => _settings.UpdateAsync(current => current with
    {
        Output = new OutputMemory
        {
            PluginId = output.PluginId,
            DeviceId = output.DeviceId,
            Name = output.Name,
            Address = output.Address,
        },
    });

    private sealed class FakeOutputs : IOutputSource
    {
        public IReadOnlyList<Output> Found { get; set; } = [];

        /// <summary>Whether the plugin that owns a device is still there when it is asked.</summary>
        public bool Opens { get; set; } = true;

        public Task<IReadOnlyList<Output>> DiscoverAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Found);

        public IStationPlayer? Open(Output output) => Opens ? new NullStationPlayer() : null;
    }
}
