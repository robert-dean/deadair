using System.Runtime.InteropServices;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Player.Mac;

/// <summary>
/// The record in macOS's own Now Playing widget, and the media keys pointed back at the app.
/// </summary>
/// <remarks>
/// <para>
/// Works from a bundled application. A plain <c>dotnet run</c> has no bundle identifier, so the
/// system has nothing to attribute the playback to and the widget stays empty — which is a property
/// of how it was launched rather than a fault, and the reason the bundle script exists.
/// </para>
/// <para>
/// The callback is held for the life of this object: the native side keeps a raw function pointer,
/// and a collected delegate would be a crash somebody hears rather than sees.
/// </para>
/// </remarks>
public sealed partial class MacSystemNowPlaying : ISystemNowPlaying
{
    private readonly NativeCommandCallback _callback;
    private bool _disposed;

    public MacSystemNowPlaying()
    {
        if (!OperatingSystem.IsMacOS())
        {
            throw new PlatformNotSupportedException("The system now-playing display is macOS only.");
        }

        _callback = OnCommand;
        SetHandler(Marshal.GetFunctionPointerForDelegate(_callback), nint.Zero);
    }

    public event Action<RemoteCommand>? Commanded;

    public void Show(NowPlayingCard card)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var artwork = card.Artwork ?? [];

        Set(
            card.Title,
            card.Artist,
            card.Album,
            artwork,
            artwork.Length,

            // Negative says the station could not say, and the widget draws no scrubber rather than
            // one stuck at zero.
            card.Duration?.TotalSeconds ?? -1,
            card.Position.TotalSeconds,
            card.Playing);
    }

    public void Clear()
    {
        if (!_disposed)
        {
            NativeClear();
        }
    }

    public void SetCanSkip(bool canSkip)
    {
        if (!_disposed)
        {
            SetSkip(canSkip);
        }
    }

    private void OnCommand(nint context, int command) => Commanded?.Invoke((RemoteCommand)command);

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        SetHandler(nint.Zero, nint.Zero);
        NativeClear();
        Commanded = null;
    }

    private delegate void NativeCommandCallback(nint context, int command);

    [LibraryImport(NativePlayer.Library, EntryPoint = "da_remote_set_handler")]
    private static partial void SetHandler(nint callback, nint context);

    [LibraryImport(NativePlayer.Library, EntryPoint = "da_remote_set_can_skip")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial void SetSkip([MarshalAs(UnmanagedType.Bool)] bool canSkip);

    [LibraryImport(NativePlayer.Library, EntryPoint = "da_nowplaying_set", StringMarshalling = StringMarshalling.Utf8)]
    private static partial void Set(
        string? title,
        string? artist,
        string? album,
        byte[] artwork,
        int artworkLength,
        double durationSeconds,
        double positionSeconds,
        [MarshalAs(UnmanagedType.Bool)] bool playing);

    [LibraryImport(NativePlayer.Library, EntryPoint = "da_nowplaying_clear")]
    private static partial void NativeClear();
}
