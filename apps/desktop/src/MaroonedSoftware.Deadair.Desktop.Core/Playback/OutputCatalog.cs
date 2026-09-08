using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>What happened when somebody chose an output.</summary>
public enum OutputSelection
{
    Selected,

    /// <summary>The plugin that owns it is gone, or has been switched off since.</summary>
    NotFound,

    /// <summary>The station's address means nothing anywhere but this machine.</summary>
    StationUnreachable,
}

/// <summary>What happened when the app tried to go back to where it was last playing.</summary>
public enum OutputRestore
{
    /// <summary>Nothing was remembered.</summary>
    ThisMac,

    Restored,

    /// <summary>Remembered, and not there. Still remembered.</summary>
    NotFound,
}

/// <summary>
/// The places the station could come out, and which one it is coming out of.
/// </summary>
/// <remarks>
/// <para>
/// Discovery happens when somebody opens the picker and when they ask it to look again, and at
/// launch to get back to where they were. Never on a timer: a scan is a broadcast and a request to
/// every device the operator wrote down, and nobody is looking between opens.
/// </para>
/// <para>
/// <b>Nothing here ever moves playback on its own.</b> A device that stopped answering is reported by
/// its own player, which the conductor already knows what to do with; quietly falling back to this
/// machine would start the Mac's speakers unasked, in a room somebody may have left, and add a
/// second listener to the station while the first was still counted.
/// </para>
/// </remarks>
public sealed class OutputCatalog(IOutputSource source, OutputSwitch @switch, ISettingsStore settings)
{
    private readonly Lock _gate = new();

    private List<Output> _devices = [];

    /// <summary>This machine first, then whatever the plugins found.</summary>
    public IReadOnlyList<Output> Outputs
    {
        get
        {
            lock (_gate)
            {
                return [Output.ThisMac, .. _devices];
            }
        }
    }

    /// <summary>Where the sound is coming out.</summary>
    public Output Active => @switch.Active;

    /// <summary>Whether the active device was not in the last scan.</summary>
    /// <remarks>
    /// Worth drawing, and worth doing nothing else about. A speaker that missed one broadcast is
    /// still playing perfectly well.
    /// </remarks>
    public bool ActiveMissing
    {
        get
        {
            lock (_gate)
            {
                return !Active.IsLocal && !_devices.Any(device => device.Key == Active.Key);
            }
        }
    }

    public bool Scanning { get; private set; }

    /// <summary>What the remembered device was called, when there is one. For a sentence about it.</summary>
    public string? Remembered => settings.Current.Output?.Name;

    /// <summary>Raised when the list or the active output changed. On an arbitrary thread.</summary>
    public event Action? Changed;

    /// <summary>Asks every plugin what it can find. Never moves playback.</summary>
    public async Task RescanAsync(CancellationToken cancellationToken = default)
    {
        Scanning = true;
        Changed?.Invoke();

        try
        {
            var found = await source.DiscoverAsync(cancellationToken).ConfigureAwait(false);

            lock (_gate)
            {
                _devices = [.. found];
            }
        }
        finally
        {
            Scanning = false;
            Changed?.Invoke();
        }
    }

    /// <summary>Moves the station, and remembers where it went.</summary>
    public async Task<OutputSelection> SelectAsync(Output output, StationUrl station, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(output);

        if (!OutputReach.CanReach(station, output))
        {
            // Asked before the device is handed anything, because a speaker given an address that
            // means nothing to it just plays silence, and silence is the hardest fault to read.
            return OutputSelection.StationUnreachable;
        }

        if (output.IsLocal)
        {
            await @switch.SelectAsync(Output.ThisMac, player: null, cancellationToken).ConfigureAwait(false);
            await RememberAsync(null, cancellationToken).ConfigureAwait(false);
            Changed?.Invoke();

            return OutputSelection.Selected;
        }

        if (source.Open(output) is not { } player)
        {
            return OutputSelection.NotFound;
        }

        await @switch.SelectAsync(output, player, cancellationToken).ConfigureAwait(false);
        await RememberAsync(output, cancellationToken).ConfigureAwait(false);
        Changed?.Invoke();

        return OutputSelection.Selected;
    }

    /// <summary>
    /// Goes back to the device somebody was last playing on.
    /// </summary>
    /// <remarks>
    /// The memory is KEPT when the device is not there. A speaker switched off tonight is on again
    /// tomorrow, and forgetting would make the app's memory depend on whether anybody happened to
    /// open it during the evening.
    /// </remarks>
    public async Task<OutputRestore> RestoreAsync(StationUrl station, CancellationToken cancellationToken = default)
    {
        if (settings.Current.Output is not { } remembered)
        {
            return OutputRestore.ThisMac;
        }

        await RescanAsync(cancellationToken).ConfigureAwait(false);

        var wanted = new Output(remembered.PluginId, remembered.DeviceId, remembered.Name, null, remembered.Address);

        lock (_gate)
        {
            // By id, then by address. A player that was given a different lease is the same speaker,
            // and one an operator wrote down by hand is known by where it is.
            var found = _devices.FirstOrDefault(device => device.Key == wanted.Key)
                ?? _devices.FirstOrDefault(device => device.Address == wanted.Address);

            if (found is not null)
            {
                wanted = found;
            }
            else if (!_devices.Any(device => device.PluginId == wanted.PluginId))
            {
                // Nothing from that plugin at all, which usually means it is switched off rather
                // than that the speaker is. Trying anyway would be reaching for a plugin that is not
                // running.
                return OutputRestore.NotFound;
            }
        }

        if (!OutputReach.CanReach(station, wanted) || source.Open(wanted) is not { } player)
        {
            return OutputRestore.NotFound;
        }

        await @switch.SelectAsync(wanted, player, cancellationToken).ConfigureAwait(false);
        Changed?.Invoke();

        return OutputRestore.Restored;
    }

    /// <summary>
    /// Lets go of a plugin's device before it is switched off or started again.
    /// </summary>
    /// <remarks>
    /// Called before a reload rather than after, so that the device is stopped by the plugin that
    /// owns it while that plugin is still there to stop it. The memory is untouched: this is the app
    /// putting the sound back on its own speakers for a moment, not somebody changing their mind.
    /// </remarks>
    public async Task ReleasePluginAsync(string pluginId, CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            _devices = [.. _devices.Where(device => device.PluginId != pluginId)];
        }

        if (Active.PluginId == pluginId)
        {
            await @switch.SelectAsync(Output.ThisMac, player: null, cancellationToken).ConfigureAwait(false);
        }

        Changed?.Invoke();
    }

    private Task<DesktopSettings> RememberAsync(Output? output, CancellationToken cancellationToken) =>
        settings.UpdateAsync(
            current => current with
            {
                Output = output is null
                    ? null
                    : new OutputMemory
                    {
                        PluginId = output.PluginId,
                        DeviceId = output.DeviceId,
                        Name = output.Name,
                        Address = output.Address,
                    },
            },
            cancellationToken);
}
