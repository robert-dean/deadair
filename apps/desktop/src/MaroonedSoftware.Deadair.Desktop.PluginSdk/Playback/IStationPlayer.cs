namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

/// <summary>
/// One mount, played.
/// </summary>
/// <remarks>
/// The seam every platform's media stack sits behind, so that neither the choice of engine nor the
/// choice of platform reaches a view model. macOS is AVFoundation; Windows would be
/// <c>Windows.Media.Playback</c> and Linux GStreamer, and both are a project and one line of the
/// composition root rather than a port.
///
/// Implementations report state and nothing else. What to DO about a state — whether a failure is
/// warm-up or a fault, when to reconnect, how long to keep trying — is policy, it is the same on
/// every platform, and it lives in the host's own <c>PlaybackConductor</c> where it can be tested
/// without a sound card. That type is deliberately NOT here: a plugin implements this interface and
/// never decides what a phase means.
/// </remarks>
public interface IStationPlayer : IAsyncDisposable
{
    PlayerStatus Status { get; }

    /// <summary>Raised on an arbitrary thread, so a subscriber that touches a view has to marshal.</summary>
    event Action<PlayerStatus>? StatusChanged;

    /// <summary>Starts, or restarts after a failure.</summary>
    Task PlayAsync(Uri mount, CancellationToken cancellationToken = default);

    /// <summary>Stops and DROPS the connection. There is no pause on a live mount; see <see cref="PlayerPhase"/>.</summary>
    Task StopAsync(CancellationToken cancellationToken = default);

    /// <summary>0.0 to 1.0.</summary>
    double Volume { get; set; }
}
