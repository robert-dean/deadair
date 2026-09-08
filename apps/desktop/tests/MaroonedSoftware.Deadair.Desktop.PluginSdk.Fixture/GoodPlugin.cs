using MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Fixture;

/// <summary>
/// A plugin that does everything right, so the loader can be pointed at a real assembly.
/// </summary>
/// <remarks>
/// <para>
/// It exists because the interesting half of a plugin loader cannot be tested with a fake. Whether
/// an interface has one identity across two load contexts, whether a deps.json is read, whether a
/// declared capability is really implemented: none of those is a decision in the loader's own code,
/// they are all facts about a file on disk being loaded by the runtime.
/// </para>
/// <para>
/// The counters are static because the point of them is to survive the instance: reconfiguring a
/// plugin disposes one and builds another, and the test that this happened cannot ask the object
/// that went away.
/// </para>
/// </remarks>
public sealed class GoodPlugin : IDeadairPlugin, IOutputTargetProvider
{
    /// <summary>How many times any instance of this class has been started.</summary>
    public static int Initialised { get; private set; }

    /// <summary>How many times any instance has been disposed.</summary>
    public static int Disposed { get; private set; }

    /// <summary>What the last one was configured with, so a test can see the host's own view.</summary>
    public static IReadOnlyDictionary<string, string> LastConfig { get; private set; } =
        new Dictionary<string, string>(StringComparer.Ordinal);

    /// <summary>The id the host said this plugin was.</summary>
    public static string? LastPluginId { get; private set; }

    /// <summary>Whether the shutdown token the last host handed over has been cancelled.</summary>
    public static bool ShutdownRequested { get; private set; }

    public static void Forget()
    {
        Initialised = 0;
        Disposed = 0;
        LastConfig = new Dictionary<string, string>(StringComparer.Ordinal);
        LastPluginId = null;
        ShutdownRequested = false;
    }

    public Task InitializeAsync(IPluginHost host, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(host);

        Initialised++;
        LastConfig = host.Config;
        LastPluginId = host.PluginId;

        host.Shutdown.Register(() => ShutdownRequested = true);
        host.Logger.Info("the fixture plugin started");

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<OutputDevice>> DiscoverAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<OutputDevice>>(
        [
            new OutputDevice("fixture-1", "A device that is not there", "Imaginary", "127.0.0.1:1"),
        ]);

    public IStationPlayer CreatePlayer(OutputDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);

        return new SilentPlayer();
    }

    public ValueTask DisposeAsync()
    {
        Disposed++;
        return ValueTask.CompletedTask;
    }

    /// <summary>Reports what it is told to and makes no sound.</summary>
    private sealed class SilentPlayer : IStationPlayer
    {
        public PlayerStatus Status { get; private set; } = PlayerStatus.Stopped;

        public event Action<PlayerStatus>? StatusChanged;

        public double Volume { get; set; } = 0.5;

        public Task PlayAsync(Uri mount, CancellationToken cancellationToken = default)
        {
            Report(new PlayerStatus(PlayerPhase.Playing));
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            Report(PlayerStatus.Stopped);
            return Task.CompletedTask;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        private void Report(PlayerStatus status)
        {
            Status = status;
            StatusChanged?.Invoke(status);
        }
    }
}
