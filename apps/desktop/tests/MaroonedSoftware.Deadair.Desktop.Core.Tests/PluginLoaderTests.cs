using System.Runtime.Loader;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Finding plugins, loading them, and refusing them.
///
/// These run against a REAL assembly rather than a fake, because the half of a loader worth testing
/// is not a decision in its own code: whether one interface has one identity across two load
/// contexts, whether a deps.json is read, whether a class the manifest names is really there. The
/// fixture plugin next door is copied into a temp directory per test and its manifest rewritten, so
/// each scenario is a plugin folder somebody could have produced.
/// </summary>
public sealed class PluginLoaderTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"deadair-plugins-{Guid.NewGuid():N}");

    /// <summary>
    /// Where the build put the fixture: <c>plugins/deadair.fixture</c> beside these tests, copied
    /// there by the same targets that put a bundled plugin inside the app.
    /// </summary>
    private static string FixtureSource =>
        Path.Combine(AppContext.BaseDirectory, "plugins", "deadair.fixture");

    /// <summary>
    /// The copy mechanism itself, which nothing else would notice breaking: a plugin that fails to
    /// be copied is a plugin the app simply does not have, and every other test here would pass by
    /// finding nothing.
    /// </summary>
    [Fact]
    public void TheBundledFixtureIsWhereTheBuildWasSupposedToPutIt()
    {
        Assert.True(Directory.Exists(FixtureSource), $"no fixture plugin at {FixtureSource}");
        Assert.True(File.Exists(Path.Combine(FixtureSource, "plugin.json")));
        Assert.True(File.Exists(Path.Combine(FixtureSource, "MaroonedSoftware.Deadair.Desktop.PluginSdk.Fixture.dll")));

        // Its own dependency list, which is what the resolver reads to find anything the plugin
        // brought with it. Without EnableDynamicLoading a class library writes none.
        Assert.True(File.Exists(Path.Combine(FixtureSource, "MaroonedSoftware.Deadair.Desktop.PluginSdk.Fixture.deps.json")));
    }

    [Fact]
    public void FindsAPluginAndReadsWhatItSaysAboutItself()
    {
        Install(PluginOrigin.Bundled);

        var record = Assert.Single(new PluginLoader(Directories()).Discover());

        Assert.Equal("deadair.fixture", record.Id);
        Assert.Equal(PluginStatus.Discovered, record.Status);
        Assert.Equal(PluginOrigin.Bundled, record.Origin);
        Assert.Null(record.Error);
        Assert.NotNull(record.Manifest);
        Assert.True(record.Declares(PluginCapabilities.OutputTarget));
    }

    [Fact]
    public void BuildsThePluginTheManifestNames()
    {
        Install(PluginOrigin.Bundled);
        var loader = new PluginLoader(Directories());

        var record = loader.Activate(loader.Discover().Single());

        Assert.Equal(PluginStatus.Active, record.Status);
        Assert.Null(record.Error);
        Assert.NotNull(record.Instance);
    }

    /// <summary>
    /// The test the whole load context exists for.
    ///
    /// A type is identified by its assembly AND the context that loaded it, so a plugin holding its
    /// own copy of the contract implements an <c>IOutputTargetProvider</c> that is not the one the
    /// app asks for. The cast below is exactly what the output picker does, and when it fails the
    /// message says a type does not implement an interface it visibly implements.
    /// </summary>
    [Fact]
    public void APluginsTypesAreTheSameTypesTheAppIsHolding()
    {
        Install(PluginOrigin.Bundled);
        var loader = new PluginLoader(Directories());

        var instance = loader.Activate(loader.Discover().Single()).Instance;

        Assert.NotNull(instance);
        Assert.IsAssignableFrom<IDeadairPlugin>(instance);
        Assert.IsAssignableFrom<IOutputTargetProvider>(instance);
    }

    /// <summary>
    /// And it is still true when the contract really is sitting beside the plugin, which is the case
    /// the shared-assembly list is written for: a plugin built without the reference marked private
    /// ships a copy, and it must be ignored in favour of the app's own.
    /// </summary>
    [Fact]
    public void EvenWhenThePluginBroughtItsOwnCopyOfTheContract()
    {
        var directory = Install(PluginOrigin.Bundled);
        var contract = typeof(PluginApi).Assembly.Location;
        File.Copy(contract, Path.Combine(directory, Path.GetFileName(contract)), overwrite: true);

        var loader = new PluginLoader(Directories());
        var instance = loader.Activate(loader.Discover().Single()).Instance;

        Assert.NotNull(instance);
        Assert.IsAssignableFrom<IOutputTargetProvider>(instance);
        Assert.Equal(
            AssemblyLoadContext.Default,
            AssemblyLoadContext.GetLoadContext(typeof(IOutputTargetProvider).Assembly));
    }

    /// <summary>
    /// The other half of the same arrangement: everything that is NOT the contract is the plugin's
    /// own, so two plugins can use different versions of the same library without either knowing.
    /// </summary>
    [Fact]
    public void ThePluginsOwnAssemblyIsKeptApartFromTheApps()
    {
        Install(PluginOrigin.Bundled);
        var loader = new PluginLoader(Directories());

        var instance = loader.Activate(loader.Discover().Single()).Instance;

        Assert.NotNull(instance);
        Assert.NotEqual(AssemblyLoadContext.Default, AssemblyLoadContext.GetLoadContext(instance.GetType().Assembly));
    }

    [Fact]
    public void ADirectoryWithNoManifestIsNotAPluginAndIsNotAComplaint()
    {
        Directory.CreateDirectory(Path.Combine(_root, "bundled", "notes"));
        File.WriteAllText(Path.Combine(_root, "bundled", "notes", "readme.txt"), "nothing to see");

        Assert.Empty(new PluginLoader(Directories()).Discover());
    }

    [Fact]
    public void AMissingPluginsFolderIsAnInstallWithNoPlugins()
    {
        Assert.Empty(new PluginLoader(Directories()).Discover());
    }

    [Fact]
    public void GarbageInTheManifestIsQuarantinedUnderTheFoldersName()
    {
        var directory = Install(PluginOrigin.User);
        File.WriteAllText(Path.Combine(directory, "plugin.json"), "{ not json");

        var record = Assert.Single(new PluginLoader(Directories()).Discover());

        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Equal("deadair.fixture", record.Id);
        Assert.NotNull(record.Error);
        Assert.Null(record.Manifest);
    }

    /// <summary>
    /// A plugin needing a contract this app does not have is refused BEFORE its assembly is opened,
    /// which is the ordering the manifest is a separate file for.
    /// </summary>
    [Fact]
    public void APluginThatNeedsALaterContractIsRefusedByItsManifestAlone()
    {
        Install(PluginOrigin.Bundled, manifest => manifest.Replace("\"^1.0.0\"", "\"^2.0.0\"", StringComparison.Ordinal));

        var record = Assert.Single(new PluginLoader(Directories()).Discover());

        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Contains("^2.0.0", record.Error, StringComparison.Ordinal);
        Assert.Contains(PluginApi.Version, record.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void ARangeNobodyCanReadIsRefusedRatherThanIgnored()
    {
        Install(PluginOrigin.Bundled, manifest => manifest.Replace("\"^1.0.0\"", "\"whatever\"", StringComparison.Ordinal));

        var record = Assert.Single(new PluginLoader(Directories()).Discover());

        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Contains("whatever", record.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void AMissingAssemblySaysSoRatherThanThrowing()
    {
        var directory = Install(PluginOrigin.Bundled);
        File.Delete(Path.Combine(directory, "MaroonedSoftware.Deadair.Desktop.PluginSdk.Fixture.dll"));

        var loader = new PluginLoader(Directories());
        var record = loader.Activate(loader.Discover().Single());

        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Contains("built", record.Error, StringComparison.Ordinal);
    }

    /// <summary>
    /// The manifest names the class in a string, so a rename moves the class and leaves the string.
    /// The message names both halves, because either could be the one that is wrong.
    /// </summary>
    [Fact]
    public void ATypeTheManifestNamesAndTheAssemblyDoesNotHaveIsQuarantined()
    {
        Install(PluginOrigin.Bundled, manifest => manifest.Replace(".GoodPlugin", ".RenamedLastWeek", StringComparison.Ordinal));

        var loader = new PluginLoader(Directories());
        var record = loader.Activate(loader.Discover().Single());

        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Contains("RenamedLastWeek", record.Error, StringComparison.Ordinal);
    }

    [Fact]
    public void AClassThatIsNotAPluginAtAllIsQuarantined()
    {
        Install(PluginOrigin.Bundled, manifest => manifest.Replace(".GoodPlugin", ".NotAPlugin", StringComparison.Ordinal));

        var loader = new PluginLoader(Directories());
        var record = loader.Activate(loader.Discover().Single());

        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Contains(nameof(IDeadairPlugin), record.Error, StringComparison.Ordinal);
    }

    /// <summary>
    /// A manifest is JSON and a class is code, so the two can drift. Catching it at load is what
    /// stops a plugin being listed as working and then answering nothing when the picker asks it for
    /// devices.
    /// </summary>
    [Fact]
    public void APluginThatClaimsACapabilityItDoesNotImplementIsQuarantined()
    {
        Install(PluginOrigin.Bundled, manifest => manifest.Replace(".GoodPlugin", ".SaysItCanPlayButCannotPlugin", StringComparison.Ordinal));

        var loader = new PluginLoader(Directories());
        var record = loader.Activate(loader.Discover().Single());

        Assert.Equal(PluginStatus.Failed, record.Status);
        Assert.Contains(nameof(IOutputTargetProvider), record.Error, StringComparison.Ordinal);
    }

    /// <summary>
    /// Bundled is read first, so a folder dropped into the operator's own directory cannot displace
    /// a plugin that shipped with the app by claiming its id.
    /// </summary>
    [Fact]
    public void TwoPluginsWithOneIdMeansTheFirstOneWins()
    {
        Install(PluginOrigin.Bundled);
        Install(PluginOrigin.User);

        var records = new PluginLoader(Directories()).Discover();

        Assert.Equal(2, records.Count);
        Assert.Equal(PluginOrigin.Bundled, records[0].Origin);
        Assert.Equal(PluginStatus.Discovered, records[0].Status);
        Assert.Equal(PluginStatus.Failed, records[1].Status);
        Assert.Contains("already installed", records[1].Error, StringComparison.Ordinal);
    }

    [Fact]
    public void OneBrokenPluginDoesNotHideTheOthers()
    {
        Install(PluginOrigin.Bundled, folder: "a-working-one");
        var broken = Install(PluginOrigin.Bundled, folder: "b-broken-one");
        File.WriteAllText(Path.Combine(broken, "plugin.json"), "{{{");
        Install(PluginOrigin.Bundled, manifest => manifest.Replace("deadair.fixture", "deadair.third", StringComparison.Ordinal), folder: "c-another-one");

        var records = new PluginLoader(Directories()).Discover();

        Assert.Equal(3, records.Count);
        Assert.Equal(PluginStatus.Failed, records[1].Status);
        Assert.Equal(PluginStatus.Discovered, records[2].Status);
    }

    /// <summary>
    /// The plugin the app actually ships, loaded the way the app will load it.
    ///
    /// Everything else here runs against a fixture written to be loaded, which cannot fail in the
    /// ways a real plugin can: a manifest naming a class that moved, a capability the class does not
    /// implement, an entry assembly whose own dependencies do not resolve. Nothing in this project
    /// references it, so what is under test is the file on disk.
    /// </summary>
    [Fact]
    public void ThePluginTheAppShipsLoadsAndCanBeAskedForDevices()
    {
        var source = Path.Combine(AppContext.BaseDirectory, "plugins", "deadair.bluos");
        Assert.True(Directory.Exists(source), $"the BluOS plugin was not built into {source}");

        var directory = Path.Combine(_root, "bundled", "deadair.bluos");
        Directory.CreateDirectory(directory);

        foreach (var file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(directory, Path.GetFileName(file)), overwrite: true);
        }

        var loader = new PluginLoader(Directories());
        var record = loader.Activate(Assert.Single(loader.Discover()));

        Assert.Equal(PluginStatus.Active, record.Status);
        Assert.Null(record.Error);
        Assert.Equal("BluOS players", record.DisplayName);
        Assert.IsAssignableFrom<IOutputTargetProvider>(record.Instance);

        // Its own assembly, in its own context, implementing the app's interface. All three at once
        // is the arrangement the whole loader exists to produce.
        Assert.NotEqual(AssemblyLoadContext.Default, AssemblyLoadContext.GetLoadContext(record.Instance!.GetType().Assembly));
    }

    private PluginDirectories Directories() =>
        new(Path.Combine(_root, "bundled"), Path.Combine(_root, "user"));

    /// <summary>Copies the fixture into one of the two directories, optionally rewriting its manifest.</summary>
    private string Install(PluginOrigin origin, Func<string, string>? manifest = null, string folder = "deadair.fixture")
    {
        var directory = Path.Combine(_root, origin == PluginOrigin.Bundled ? "bundled" : "user", folder);
        Directory.CreateDirectory(directory);

        foreach (var file in Directory.GetFiles(FixtureSource))
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
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }
}
