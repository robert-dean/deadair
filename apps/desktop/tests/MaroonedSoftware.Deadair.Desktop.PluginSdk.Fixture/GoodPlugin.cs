using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Fixture;

/// <summary>
/// Where this plugin writes down what happened to it, so a test can read it.
/// </summary>
/// <remarks>
/// <para>
/// A FILE, and it is worth saying why rather than a static field or a reference to the test project.
/// A plugin is loaded into its own context, so its statics are not the test's statics even though
/// both are in one process — and the test project deliberately cannot reference this assembly, since
/// a test that compiled against a plugin would prove the loader works on something the runtime had
/// already loaded for it.
/// </para>
/// <para>
/// It goes BESIDE this assembly rather than at a path somebody passed in. Each test copies the
/// plugin into a directory of its own, so writing next to itself is automatically one diary per
/// test; anything process-wide, an environment variable most of all, would be shared by every test
/// running at that moment.
/// </para>
/// <para>
/// It is also what a plugin genuinely has: somewhere to write, and no way to reach into the app.
/// </para>
/// </remarks>
public static class FixtureDiary
{
    /// <summary>Beside the plugin's own assembly, which is a directory per installed copy.</summary>
    public static string Path { get; } = System.IO.Path.Combine(
        System.IO.Path.GetDirectoryName(typeof(FixtureDiary).Assembly.Location) ?? ".",
        "diary.txt");

    public static void Write(string line)
    {
        // Retried, because one instance is disposed while its replacement is starting and the two
        // may reach the file together.
        for (var attempt = 0; attempt < 20; attempt++)
        {
            try
            {
                File.AppendAllText(Path, line + Environment.NewLine);
                return;
            }
            catch (IOException)
            {
                Thread.Sleep(5);
            }
        }
    }
}

/// <summary>
/// A plugin that does everything right, so the loader can be pointed at a real assembly.
/// </summary>
/// <remarks>
/// It exists because the interesting half of a plugin loader is not a decision in its own code:
/// whether an interface has one identity across two load contexts, whether a deps.json is read,
/// whether the class a manifest names is really there. Those are facts about a file on disk being
/// loaded by the runtime, and only a real file can answer them.
/// </remarks>
public sealed class GoodPlugin : IDeadairPlugin, IOutputTargetProvider
{
    public Task InitializeAsync(IPluginHost host, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(host);

        FixtureDiary.Write(string.Create(CultureInfo.InvariantCulture, $"init {host.PluginId}"));

        foreach (var (key, value) in host.Config.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            FixtureDiary.Write(string.Create(CultureInfo.InvariantCulture, $"config {key}={value}"));
        }

        host.Shutdown.Register(() => FixtureDiary.Write("shutdown"));
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
        FixtureDiary.Write("dispose");
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
