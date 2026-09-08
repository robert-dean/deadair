using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Net;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>One line a plugin wrote.</summary>
public readonly record struct PluginLogEntry(DateTimeOffset At, PluginLogLevel Level, string Message);

/// <summary>
/// What one plugin was given, and the bookkeeping that goes with it.
/// </summary>
/// <remarks>
/// Built per instance and disposed with it, so a plugin reconfigured mid-request cannot go on using
/// the client and the token of the instance that was replaced.
/// </remarks>
internal sealed class PluginHost : IPluginHost, IDisposable
{
    /// <summary>
    /// Enough to answer "why can it not see my speaker", which is the entire diagnosis story for a
    /// device plugin and one no phase enum can tell. Bounded, because a poll loop writing a line a
    /// second would otherwise be a slow leak.
    /// </summary>
    private const int LinesKept = 50;

    private readonly ConcurrentQueue<PluginLogEntry> _lines = new();
    private readonly CancellationTokenSource _shutdown = new();

    public PluginHost(string pluginId, IReadOnlyDictionary<string, string> config, TimeProvider clock)
    {
        PluginId = pluginId;
        Config = config;
        Clock = clock;
        Logger = new LinesAndTrace(this);

        // NOT StationHttp.Create. That client carries the station's User-Agent and its session
        // handler, and the one-client rule it enforces is about being counted as a single LISTENER.
        // A plugin talks to a box on the local network: a different listener by design, and one that
        // must never see the station's bearer token.
        Http = new HttpClient(new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            ConnectTimeout = TimeSpan.FromSeconds(10),
            AutomaticDecompression = System.Net.DecompressionMethods.All,
        })
        {
            // Infinite, and every request is expected to carry its own deadline. A client's timeout
            // cannot be changed after its first request, and a plugin that long-polls a device needs
            // a longer wait than any one number would serve both it and a quick command.
            Timeout = Timeout.InfiniteTimeSpan,
        };

        Http.DefaultRequestHeaders.Add(
            "User-Agent",
            string.Create(CultureInfo.InvariantCulture, $"{UserAgent.Value} (plugin {pluginId})"));
    }

    public string PluginId { get; }

    public IPluginLogger Logger { get; }

    public HttpClient Http { get; }

    public IReadOnlyDictionary<string, string> Config { get; }

    public TimeProvider Clock { get; }

    public CancellationToken Shutdown => _shutdown.Token;

    /// <summary>What the plugin has said, oldest first.</summary>
    public IReadOnlyList<PluginLogEntry> Lines => [.. _lines];

    /// <summary>
    /// Tells the plugin it is going away, before anything is disposed, so work in flight can stop
    /// rather than be cut off.
    /// </summary>
    public void RequestShutdown()
    {
        if (!_shutdown.IsCancellationRequested)
        {
            _shutdown.Cancel();
        }
    }

    public void Dispose()
    {
        RequestShutdown();
        _shutdown.Dispose();
        Http.Dispose();
    }

    private void Write(PluginLogLevel level, string message, Exception? exception)
    {
        var text = exception is null ? message : $"{message}: {exception.Message}";

        _lines.Enqueue(new PluginLogEntry(Clock.GetUtcNow(), level, text));

        while (_lines.Count > LinesKept && _lines.TryDequeue(out _))
        {
            // Oldest out. A device plugin's useful lines are the recent ones.
        }

        Trace.WriteLine($"[{PluginId}] {level}: {text}");
    }

    private sealed class LinesAndTrace(PluginHost host) : IPluginLogger
    {
        public void Log(PluginLogLevel level, string message, Exception? exception = null) =>
            host.Write(level, message, exception);
    }
}
