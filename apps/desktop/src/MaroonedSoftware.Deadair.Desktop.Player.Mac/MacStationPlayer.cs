using System.Runtime.InteropServices;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Player.Mac;

/// <summary>
/// The station, played by AVFoundation.
/// </summary>
/// <remarks>
/// <para>
/// One player per mount: <see cref="PlayAsync"/> tears down whatever was playing and builds a new
/// native player, because switching format means a different connection anyway and a live stream has
/// nothing to seek.
/// </para>
/// <para>
/// The user agent is fixed at construction and applied to the audio connection itself. That is not
/// tidiness: the station counts an HLS listener per IP and agent, so a player sending a different
/// agent from the app's API and artwork requests is counted as a second listener.
/// </para>
/// </remarks>
public sealed class MacStationPlayer : IStationPlayer
{
    private readonly string _userAgent;
    private readonly object _gate = new();

    /// <summary>
    /// Held so the callback the native side holds a pointer to is not collected while it is live.
    /// </summary>
    private readonly NativePlayer.StatusCallback _callback;
    private readonly nint _callbackPointer;

    private nint _handle;
    private double _volume = 1.0;
    private bool _disposed;

    public MacStationPlayer(string userAgent)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(userAgent);

        if (!OperatingSystem.IsMacOS())
        {
            throw new PlatformNotSupportedException("The AVFoundation player runs on macOS only.");
        }

        _userAgent = userAgent;

        // An instance method rather than [UnmanagedCallersOnly], which cannot be an instance method
        // and would need a handle table to find its way back to `this`. One player per window makes
        // that not worth it.
        unsafe
        {
            _callback = OnNativeStatus;
        }

        _callbackPointer = Marshal.GetFunctionPointerForDelegate(_callback);
    }

    public PlayerStatus Status { get; private set; } = PlayerStatus.Stopped;

    public event Action<PlayerStatus>? StatusChanged;

    public double Volume
    {
        get => _volume;
        set
        {
            _volume = Math.Clamp(value, 0.0, 1.0);
            lock (_gate)
            {
                if (_handle != nint.Zero)
                {
                    NativePlayer.SetVolume(_handle, _volume);
                }
            }
        }
    }

    public Task PlayAsync(Uri mount, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(mount);
        ObjectDisposedException.ThrowIf(_disposed, this);

        lock (_gate)
        {
            DestroyHandle();

            nint handle;
            unsafe
            {
                handle = NativePlayer.Create(mount.ToString(), _userAgent, _callbackPointer, null);
            }

            if (handle == nint.Zero)
            {
                Report(new PlayerStatus(PlayerPhase.Failed, $"The player refused the address {mount}."));
                return Task.CompletedTask;
            }

            _handle = handle;
            NativePlayer.SetVolume(handle, _volume);
            NativePlayer.Play(handle);
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            if (_handle != nint.Zero)
            {
                NativePlayer.Stop(_handle);
                DestroyHandle();
            }
        }

        Report(PlayerStatus.Stopped);
        return Task.CompletedTask;
    }

    private unsafe void OnNativeStatus(void* context, int phase, byte* detail)
    {
        var text = detail == null ? null : Marshal.PtrToStringUTF8((nint)detail);
        Report(new PlayerStatus((PlayerPhase)phase, text));
    }

    private void Report(PlayerStatus status)
    {
        Status = status;
        StatusChanged?.Invoke(status);
    }

    /// <summary>Caller holds <see cref="_gate"/>.</summary>
    private void DestroyHandle()
    {
        if (_handle == nint.Zero)
        {
            return;
        }

        var handle = _handle;
        _handle = nint.Zero;
        NativePlayer.Destroy(handle);
    }

    public ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return ValueTask.CompletedTask;
        }

        _disposed = true;

        lock (_gate)
        {
            if (_handle != nint.Zero)
            {
                NativePlayer.Stop(_handle);
                DestroyHandle();
            }
        }

        return ValueTask.CompletedTask;
    }
}
