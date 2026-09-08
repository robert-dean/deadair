namespace MaroonedSoftware.Deadair.Desktop.PluginSdk;

/// <summary>
/// What a plugin says it can do.
/// </summary>
/// <remarks>
/// <para>
/// A capability is the unit of DISPATCH: the host asks for every active plugin implementing an
/// interface and never for a plugin of a KIND. That is the station's own arrangement and the reason
/// for it is the same — a plugin that declares a kind and then forgets a method is a failure in the
/// middle of a request, while a plugin whose declared capability does not match its instance is
/// caught once, at load, and quarantined with a sentence.
/// </para>
/// <para>
/// The vocabulary is open. A plugin built against a later contract may declare a capability this app
/// has never heard of, and the right answer is to load it for the capabilities that ARE understood
/// rather than to refuse it outright.
/// </para>
/// </remarks>
public static class PluginCapabilities
{
    /// <summary>
    /// Somewhere other than this machine to play the station: a network speaker, an amplifier.
    /// </summary>
    /// <remarks>
    /// Implemented as <see cref="Output.IOutputTargetProvider"/>. The plugin finds the devices and
    /// hands back a player for one; everything about what a phase MEANS stays with the host.
    /// </remarks>
    public const string OutputTarget = "output-target";
}
