using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// The one player the app talks to, forwarding to wherever the sound is meant to come out.
/// </summary>
/// <remarks>
/// <para>
/// Everything above this — the transport, the conductor, the widget, the bar — holds one player and
/// one subscription and never learns that there is more than one place to play. That is the point:
/// the rule this type exists to keep is a rule about two players at once, and spreading it across a
/// view model would be spreading it across a class that cannot be built in a test.
/// </para>
/// <para>
/// <b>Changing output is a TRANSFER and never an addition.</b> A network player fetching the mount
/// is a listener to the station in its own right, anonymous and counted, so a moment with both
/// playing is a moment the station is serving two audiences for one person — and on an
/// audience-gated station it is also five minutes of holding the mount open for a listener who has
/// walked away. So the old target is detached, stopped and dropped BEFORE the new one is asked for
/// anything.
/// </para>
/// </remarks>
public sealed class OutputSwitch : IStationPlayer, IVolumeReadback
{
    private readonly IStationPlayer _local;
    private readonly Lock _gate = new();

    private IStationPlayer _current;
    private IStationPlayer? _device;
    private Action<PlayerStatus> _forwarding;
    private bool _disposed;

    public OutputSwitch(IStationPlayer local)
    {
        _local = local;
        _current = local;
        Active = Output.ThisMac;

        _forwarding = Listen(local);
    }

    /// <summary>Where the sound is coming out.</summary>
    public Output Active { get; private set; }

    public bool IsLocal => Active.IsLocal;

    /// <summary>What is playing, or null when nothing is.</summary>
    public Uri? Mount { get; private set; }

    public PlayerStatus Status => _current.Status;

    public event Action<PlayerStatus>? StatusChanged;

    /// <summary>
    /// Raised after the new target is current and BEFORE it is asked to play, so that whoever is
    /// watching can treat the seconds after a handover as warm-up rather than as a stall.
    /// </summary>
    public event Action<Output>? TargetChanged;

    /// <summary>Whether the current target has said how loud it is. Always true for this machine.</summary>
    public bool VolumeKnown => _current is IVolumeReadback readback ? readback.VolumeKnown : true;

    public event Action? VolumeChanged;

    /// <summary>
    /// 0.0 to 1.0, on whichever target is current.
    /// </summary>
    /// <remarks>
    /// A device's volume belongs to the device, so this reads and writes THROUGH rather than keeping
    /// a number of its own that could disagree with the speaker in the next room.
    /// </remarks>
    public double Volume
    {
        get => _current.Volume;
        set => _current.Volume = value;
    }

    /// <summary>
    /// Moves the station to another output, stopping the old one first.
    /// </summary>
    /// <param name="output">Where it should come out now.</param>
    /// <param name="player">
    /// The player for it, from whichever plugin owns it. Null for
    /// <see cref="Output.ThisMac"/>, whose player is kept for the life of the app.
    /// </param>
    public async Task SelectAsync(Output output, IStationPlayer? player, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(output);
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (output.IsLocal != (player is null))
        {
            throw new ArgumentException(
                output.IsLocal
                    ? "this machine's own player is the one it already has"
                    : $"{output.Name} needs a player from {output.PluginId}",
                nameof(player));
        }

        if (output.Key == Active.Key)
        {
            return;
        }

        var wasPlaying = Mount;
        var leaving = _current;
        var leavingDevice = _device;

        // Detached first, so nothing the old target says on its way out reaches a conductor that is
        // about to be told about a different player. Its stop is not a drop; it is this.
        leaving.StatusChanged -= _forwarding;

        if (leaving is IVolumeReadback wasReadback)
        {
            wasReadback.VolumeChanged -= RaiseVolumeChanged;
        }

        try
        {
            await leaving.StopAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is not OperationCanceledException and not OutOfMemoryException)
        {
            // A device that would not stop is a problem for the station's listener count and not a
            // reason to refuse to move on: the operator asked for the sound somewhere else.
        }

        var arriving = player ?? _local;

        lock (_gate)
        {
            _current = arriving;
            _device = output.IsLocal ? null : player;
            Active = output;
        }

        _forwarding = Listen(arriving);

        if (arriving is IVolumeReadback readback)
        {
            readback.VolumeChanged += RaiseVolumeChanged;
        }

        // The old device is thrown away rather than kept warm. Keeping it would mean holding a
        // watcher and a connection to a player nobody is listening on.
        if (leavingDevice is not null)
        {
            await leavingDevice.DisposeAsync().ConfigureAwait(false);
        }

        TargetChanged?.Invoke(output);
        RaiseVolumeChanged();

        if (wasPlaying is { } mount)
        {
            await arriving.PlayAsync(mount, cancellationToken).ConfigureAwait(false);
        }
    }

    public Task PlayAsync(Uri mount, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(mount);

        Mount = mount;
        return _current.PlayAsync(mount, cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        Mount = null;
        return _current.StopAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        IStationPlayer? device;

        lock (_gate)
        {
            device = _device;
            _device = null;
        }

        if (device is not null)
        {
            await device.DisposeAsync().ConfigureAwait(false);
        }

        await _local.DisposeAsync().ConfigureAwait(false);
    }

    /// <summary>
    /// Subscribes to one target, and passes on only what that target says while it is still the one.
    /// </summary>
    /// <remarks>
    /// Detaching the handler is not enough on its own. A player reports on whatever thread it likes,
    /// so an event can already be on its way when the handover happens, and it would arrive telling
    /// the conductor that the player it is now watching had stopped — which is a reconnect, of the
    /// wrong device, in the middle of a deliberate move. The handler knows which target it belongs
    /// to and says nothing once that is no longer the current one.
    /// </remarks>
    private Action<PlayerStatus> Listen(IStationPlayer target)
    {
        void Forward(PlayerStatus status)
        {
            if (!ReferenceEquals(Volatile.Read(ref _current), target))
            {
                return;
            }

            StatusChanged?.Invoke(status);
        }

        target.StatusChanged += Forward;

        return Forward;
    }

    private void RaiseVolumeChanged() => VolumeChanged?.Invoke();
}
