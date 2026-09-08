using System.Runtime.InteropServices;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Player.Mac;

/// <summary>
/// The C surface of <c>libdeadairplayer.dylib</c>, which is AVFoundation with the Objective-C left
/// on the other side.
/// </summary>
/// <remarks>
/// Nothing here is public. <see cref="MacStationPlayer"/> is the only caller, and it is what turns
/// these into an <c>IStationPlayer</c>.
/// </remarks>
internal static partial class NativePlayer
{
    internal const string Library = "libdeadairplayer";

    /// <summary>Called from the native side on an arbitrary thread.</summary>
    internal unsafe delegate void StatusCallback(void* context, int phase, byte* detail);

    [LibraryImport(Library, EntryPoint = "da_player_create", StringMarshalling = StringMarshalling.Utf8)]
    internal static unsafe partial nint Create(string url, string userAgent, nint callback, void* context);

    [LibraryImport(Library, EntryPoint = "da_player_play")]
    internal static partial void Play(nint handle);

    [LibraryImport(Library, EntryPoint = "da_player_stop")]
    internal static partial void Stop(nint handle);

    [LibraryImport(Library, EntryPoint = "da_player_phase")]
    internal static partial int Phase(nint handle);

    [LibraryImport(Library, EntryPoint = "da_player_set_volume")]
    internal static partial void SetVolume(nint handle, double volume);

    [LibraryImport(Library, EntryPoint = "da_player_destroy")]
    internal static partial void Destroy(nint handle);

    [LibraryImport(Library, EntryPoint = "da_player_pump")]
    internal static partial void Pump(double seconds);
}
