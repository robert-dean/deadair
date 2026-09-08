namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// Somewhere the station can come out.
/// </summary>
/// <param name="PluginId">Which plugin owns it, or <see cref="LocalPluginId"/> for this machine.</param>
/// <param name="DeviceId">Stable across discoveries and restarts, because it is what gets remembered.</param>
/// <param name="Name">What it is called on the picker.</param>
/// <param name="Model">The hardware, when a plugin said. A second line, never an identity.</param>
/// <param name="Address">
/// Where it is, in whatever shape the owning plugin reads. Empty for this machine, which is not
/// anywhere.
/// </param>
public sealed record Output(string PluginId, string DeviceId, string Name, string? Model, string Address)
{
    /// <summary>Not a plugin. The one output that is always there and cannot go away.</summary>
    public const string LocalPluginId = "local";

    /// <summary>
    /// This machine's own speakers, whatever the platform's player turns out to be.
    /// </summary>
    /// <remarks>
    /// An output like any other, so that the picker has nothing special in it and so that "play
    /// here" and "play there" are the same operation with different arguments.
    /// </remarks>
    public static Output ThisMac { get; } = new(LocalPluginId, "this-mac", "This Mac", null, string.Empty);

    public bool IsLocal => PluginId == LocalPluginId;

    /// <summary>Plugin and device together, which is what makes two devices with one name different.</summary>
    public string Key => $"{PluginId}/{DeviceId}";
}
