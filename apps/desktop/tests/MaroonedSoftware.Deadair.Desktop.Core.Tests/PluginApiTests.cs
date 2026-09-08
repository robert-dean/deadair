using System.Reflection;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The contract version is written twice and must not drift.
///
/// A plugin's declared range is checked against the CONSTANT, while the runtime binds its reference
/// against the ASSEMBLY. If those two disagree, a plugin can pass the check the host makes and then
/// fail to load for a reason the host has already ruled out — which is the failure the range check
/// exists to prevent, arriving through the check itself.
/// </summary>
public sealed class PluginApiTests
{
    [Fact]
    public void TheConstantAndTheAssemblyAgree_WhichIsWhatMakesTheRangeCheckMeanAnything()
    {
        var assembly = typeof(PluginApi).Assembly.GetName().Version;

        Assert.NotNull(assembly);
        Assert.Equal(PluginApi.Version, $"{assembly.Major}.{assembly.Minor}.{assembly.Build}");
    }

    [Fact]
    public void TheManifestIsNamedTheSameThingTheApiIs()
    {
        Assert.Equal("plugin.json", PluginApi.ManifestFileName);
    }

    /// <summary>
    /// The seam a plugin implements lives in the contract assembly and not in Core.
    /// </summary>
    /// <remarks>
    /// Stated as a test because it is the whole reason the assembly exists: a plugin references this
    /// one and nothing else, so a type that drifts back into Core takes Core's own dependencies —
    /// the generated SDK, sessions, settings — into the plugin API surface with it.
    /// </remarks>
    [Fact]
    public void ThePlayerSeamIsInTheContractAssembly_NotInCore()
    {
        Assert.Equal(typeof(PluginApi).Assembly, typeof(PluginSdk.Playback.IStationPlayer).Assembly);
        Assert.Equal(typeof(PluginApi).Assembly, typeof(PluginSdk.Playback.PlayerPhase).Assembly);
        Assert.NotEqual(typeof(PluginApi).Assembly, typeof(Playback.PlaybackConductor).Assembly);
    }
}
