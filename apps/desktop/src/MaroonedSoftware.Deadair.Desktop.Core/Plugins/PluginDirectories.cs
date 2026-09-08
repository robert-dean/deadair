using MaroonedSoftware.Deadair.Desktop.Core.Settings;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>Whether a plugin came with the app or was put there.</summary>
public enum PluginOrigin
{
    /// <summary>Shipped inside the app. Enabled unless somebody turns it off.</summary>
    Bundled,

    /// <summary>
    /// Dropped into the operator's own plugins folder. Discovered and listed, but never run until
    /// somebody switches it on, because code that arrived without being asked for should not start
    /// itself.
    /// </summary>
    User,
}

/// <summary>
/// The two places a plugin can be.
/// </summary>
/// <param name="Bundled">
/// Inside the app's own directory. In a bundle that is <c>Contents/MacOS/plugins</c>, which is where
/// the build puts one; under <c>dotnet run</c> it is beside the assemblies.
/// </param>
/// <param name="User">
/// <c>~/Library/Application Support/deadair/plugins</c>, beside the settings file. Somewhere an
/// operator can reach without going inside an application bundle, and somewhere an app update does
/// not overwrite.
/// </param>
public sealed record PluginDirectories(string Bundled, string User)
{
    public static PluginDirectories Default() => new(
        Path.Combine(AppContext.BaseDirectory, "plugins"),
        Path.Combine(FileSettingsStore.DefaultDirectory(), "plugins"));
}
