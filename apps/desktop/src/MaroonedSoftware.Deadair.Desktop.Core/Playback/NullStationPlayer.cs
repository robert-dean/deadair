namespace MaroonedSoftware.Deadair.Desktop.Core.Playback;

/// <summary>
/// A player that reports what it is asked to and makes no sound.
/// </summary>
/// <remarks>
/// For tests, and for CI, where there is no audio device and no point pretending otherwise. It is in
/// the Core project rather than a test project so that a headless build of the app can be composed
/// against it.
/// </remarks>
public sealed class NullStationPlayer : IStationPlayer
{
    public PlayerStatus Status { get; private set; } = PlayerStatus.Stopped;

    public event Action<PlayerStatus>? StatusChanged;

    public double Volume { get; set; } = 1.0;

    public Uri? LastMount { get; private set; }

    public Task PlayAsync(Uri mount, CancellationToken cancellationToken = default)
    {
        LastMount = mount;
        Report(new PlayerStatus(PlayerPhase.Opening));
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        Report(PlayerStatus.Stopped);
        return Task.CompletedTask;
    }

    /// <summary>Drives a phase, so a test can say what the platform did.</summary>
    public void Report(PlayerStatus status)
    {
        Status = status;
        StatusChanged?.Invoke(status);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
