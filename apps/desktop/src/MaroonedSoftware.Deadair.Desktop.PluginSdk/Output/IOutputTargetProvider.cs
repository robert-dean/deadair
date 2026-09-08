using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;

/// <summary>
/// A plugin that knows about somewhere else to play the station.
/// </summary>
/// <remarks>
/// <para>
/// Declared as <see cref="PluginCapabilities.OutputTarget"/>. The plugin's job is to find devices and
/// to drive one; what a phase means, when to retry and what a listener is told stay with the host,
/// which is the same division the platform players are built on.
/// </para>
/// <para>
/// <b>A device playing the mount is a listener to the station in its own right.</b> The host makes
/// switching output a transfer — this machine stops and drops its connection, then the device starts
/// — so a player here must never leave a device streaming after it has been stopped or disposed.
/// </para>
/// </remarks>
public interface IOutputTargetProvider
{
    /// <summary>
    /// Look for devices.
    /// </summary>
    /// <remarks>
    /// Called when somebody opens the output picker and when they ask it to look again, never on a
    /// timer. It should answer in a couple of seconds whether or not it found anything: a discovery
    /// that waits for certainty is a picker that does not open. Answering with an empty list is a
    /// fine answer; throwing is reported and logged.
    /// </remarks>
    Task<IReadOnlyList<OutputDevice>> DiscoverAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Build a player for one device. No network work: the host may build several while somebody is
    /// deciding, and only one of them will ever be asked to play.
    /// </summary>
    /// <remarks>
    /// The host owns what comes back and disposes it when the output changes. The device passed in
    /// may be one this plugin never discovered — a remembered choice, or an address an operator
    /// typed — so read <see cref="OutputDevice.Address"/> rather than looking the id up in a table.
    /// </remarks>
    IStationPlayer CreatePlayer(OutputDevice device);
}
