using MaroonedSoftware.Deadair.Desktop.Core.Settings;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>
/// One plugin, as the settings page needs it.
/// </summary>
/// <param name="Id">Its own id, which is what its settings are keyed by.</param>
/// <param name="Name">What it calls itself, or its folder when the manifest could not be read.</param>
/// <param name="Version">Its own version. Shown, never interpreted.</param>
/// <param name="Origin">"Bundled" or "Installed", which is what decides whether it runs by default.</param>
/// <param name="Enabled">Whether it runs.</param>
/// <param name="Fields">What it declared an operator can set.</param>
/// <param name="Values">What has been set, by key.</param>
/// <param name="Problem">Why it is not working, when it is not.</param>
/// <param name="Log">The last few things it said, so "why can it not see my speaker" has an answer.</param>
public sealed record PluginInfo(
    string Id,
    string Name,
    string Version,
    string Origin,
    bool Enabled,
    IReadOnlyList<FieldSpec> Fields,
    IReadOnlyDictionary<string, string> Values,
    string? Problem,
    IReadOnlyList<string> Log);

/// <summary>
/// The plugins, as something a page can draw and change.
/// </summary>
/// <remarks>
/// A seam so that the settings page can be built and posed without a loader, and so that the app's
/// own UI never touches the plugin contract's types. Everything crossing it is the app's own.
/// </remarks>
public interface IPluginCatalog
{
    IReadOnlyList<PluginInfo> Plugins { get; }

    /// <summary>Raised when any of that changed. On an arbitrary thread.</summary>
    event Action? Changed;

    Task SetEnabledAsync(string id, bool enabled, CancellationToken cancellationToken = default);

    Task SaveAsync(string id, IReadOnlyDictionary<string, string> values, CancellationToken cancellationToken = default);
}

/// <summary>An installation with no plugins, and what a shot draws against.</summary>
public sealed class NoPluginCatalog(IReadOnlyList<PluginInfo>? plugins = null) : IPluginCatalog
{
    public IReadOnlyList<PluginInfo> Plugins { get; } = plugins ?? [];

    public event Action? Changed;

    public Task SetEnabledAsync(string id, bool enabled, CancellationToken cancellationToken = default)
    {
        Changed?.Invoke();
        return Task.CompletedTask;
    }

    public Task SaveAsync(string id, IReadOnlyDictionary<string, string> values, CancellationToken cancellationToken = default)
    {
        Changed?.Invoke();
        return Task.CompletedTask;
    }
}
