namespace MaroonedSoftware.Deadair.Desktop.PluginSdk;

/// <summary>
/// What version of this contract the app implements, and what a plugin is recognised by.
/// </summary>
/// <remarks>
/// <para>
/// A plugin declares an <c>apiVersion</c> RANGE and the host checks it against <see cref="Version"/>
/// before the plugin's assembly is opened, which is what makes an incompatible plugin a sentence on
/// the settings page rather than a <c>TypeLoadException</c> halfway through a discovery.
/// </para>
/// <para>
/// When to move it. <b>Patch</b> for host behaviour a plugin cannot see. <b>Minor</b> for a member
/// only the HOST implements, such as another property on <c>IPluginHost</c>: every existing plugin
/// still satisfies the contract. <b>Major</b> for anything a PLUGIN implements — a method on
/// <c>IDeadairPlugin</c> or a capability interface, a moved type, a changed record — because every
/// plugin built against the old shape now fails to load, and the range check is what turns that into
/// an explanation instead of a crash.
/// </para>
/// </remarks>
public static class PluginApi
{
    /// <summary>The contract version, as a semver triple.</summary>
    public const string Version = "1.0.0";

    /// <summary>
    /// The file that makes a directory a plugin.
    /// </summary>
    /// <remarks>
    /// Read BEFORE any of the plugin's code is loaded, which is the whole reason it is a file rather
    /// than an assembly attribute: the id, the api range and the declared fields are needed to
    /// decide whether to load at all, and to draw a DISABLED plugin's settings with nothing running.
    /// </remarks>
    public const string ManifestFileName = "plugin.json";
}
