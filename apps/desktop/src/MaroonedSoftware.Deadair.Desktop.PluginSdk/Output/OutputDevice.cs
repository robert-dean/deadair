namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;

/// <summary>
/// One place a plugin found that the station could play.
/// </summary>
/// <param name="Id">
/// Stable across discoveries and across restarts, because it is what gets remembered when somebody
/// chooses this device. Whatever the protocol offers as a primary key: a MAC, a serial, a uuid.
/// Never the address, which moves.
/// </param>
/// <param name="Name">What its owner called it. Drawn as-is.</param>
/// <param name="Model">The hardware, when the device says. A second line, never an identity.</param>
/// <param name="Address">
/// Where to reach it, in whatever shape the PLUGIN reads: a <c>host:port</c>, a URL, a socket path.
/// Opaque to the host, which only stores it and hands it back.
/// <para>
/// It is on the record rather than kept in the plugin's own table so that a device chosen last week
/// can be reopened at launch without waiting for a discovery round to find it again, and so that an
/// address an operator typed by hand is a device like any other rather than a special case.
/// </para>
/// </param>
public sealed record OutputDevice(string Id, string Name, string? Model, string Address);
