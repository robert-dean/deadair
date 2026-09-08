using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// Where the outputs other than this machine come from.
/// </summary>
/// <remarks>
/// A seam, so that the catalog above it can be tested without a plugin loader, and so that Core does
/// not reference the plugin contract's discovery types. The app implements it over the plugins that
/// declared an output capability.
/// </remarks>
public interface IOutputSource
{
    /// <summary>Every device every enabled plugin can find, now.</summary>
    Task<IReadOnlyList<Output>> DiscoverAsync(CancellationToken cancellationToken);

    /// <summary>
    /// A player for one device, or null when the plugin that owns it has gone or been switched off.
    /// </summary>
    IStationPlayer? Open(Output output);
}

/// <summary>An installation with no plugins, which is every installation until one is enabled.</summary>
public sealed class NoOutputSource : IOutputSource
{
    public Task<IReadOnlyList<Output>> DiscoverAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<Output>>([]);

    public IStationPlayer? Open(Output output) => null;
}
