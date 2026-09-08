using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Manifest;

namespace MaroonedSoftware.Deadair.Desktop.Core.Plugins;

/// <summary>
/// The plugins this install has, and what has been decided about each.
/// </summary>
/// <remarks>
/// <para>
/// One instance per plugin at a time. Enabling starts one, disabling ends one, and saving
/// configuration ends one and starts another: a plugin reads its settings when it starts, so the
/// only honest way to apply a change is to start again. That is the station's own rule for the same
/// reason.
/// </para>
/// <para>
/// Nothing here throws for a plugin's sake. A plugin that fails is a row on a page.
/// </para>
/// </remarks>
public sealed class PluginManager(
    PluginLoader loader,
    ISettingsStore settings,
    TimeProvider clock,
    TimeSpan? startDeadline = null) : IAsyncDisposable
{
    /// <summary>
    /// How long a plugin gets to start.
    /// </summary>
    /// <remarks>
    /// Generous, because a device plugin's start may include looking for devices on a network where
    /// nothing answers. Bounded at all, because the alternative is an app that never finishes
    /// starting because of a plugin nobody is currently using. A test that wants to watch the
    /// deadline pass shortens it rather than waiting out the real one.
    /// </remarks>
    private readonly TimeSpan _startDeadline = startDeadline ?? TimeSpan.FromSeconds(30);

    private readonly Dictionary<string, PluginHost> _hosts = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SemaphoreSlim> _oneAtATime = new(StringComparer.Ordinal);
    private readonly Lock _records = new();

    private List<PluginRecord> _all = [];
    private bool _disposed;

    /// <summary>Every plugin found, in the order they were found.</summary>
    public IReadOnlyList<PluginRecord> Records
    {
        get
        {
            lock (_records)
            {
                return [.. _all];
            }
        }
    }

    /// <summary>Raised on an arbitrary thread whenever the list or any plugin's state changed.</summary>
    public event Action? Changed;

    /// <summary>Finds every plugin and starts the ones that are switched on.</summary>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        var found = loader.Discover();

        lock (_records)
        {
            _all = [.. found.Select(WithDecision)];
        }

        foreach (var record in Records.Where(record => record.Status == PluginStatus.Discovered))
        {
            await StartOneAsync(record.Id, cancellationToken).ConfigureAwait(false);
        }

        Changed?.Invoke();
    }

    /// <summary>Switches a plugin on or off, and remembers which.</summary>
    public async Task SetEnabledAsync(string id, bool enabled, CancellationToken cancellationToken = default)
    {
        var record = Find(id);

        if (record is null)
        {
            return;
        }

        var stored = await settings.UpdateAsync(
            current => current.WithPlugin(id, Existing(current, id) with { Enabled = enabled }),
            cancellationToken).ConfigureAwait(false);

        _ = stored;

        await StopOneAsync(id).ConfigureAwait(false);

        if (enabled)
        {
            Replace(id, current => current with { Status = PluginStatus.Discovered, Error = null });
            await StartOneAsync(id, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            Replace(id, current => current with { Status = PluginStatus.Disabled, Error = null });
        }

        Changed?.Invoke();
    }

    /// <summary>
    /// Writes a plugin's configuration and starts it again with it, when it is running.
    /// </summary>
    /// <remarks>
    /// A plugin reads its settings once, at start, which is what makes an instance a thing with a
    /// configuration rather than a thing that keeps checking one. So a change is applied by ending
    /// the instance and building another.
    /// </remarks>
    public async Task SaveConfigAsync(string id, IReadOnlyDictionary<string, string> values, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(values);

        var record = Find(id);

        if (record is null)
        {
            return;
        }

        await settings.UpdateAsync(
            current => current.WithPlugin(id, Existing(current, id) with { Config = values }),
            cancellationToken).ConfigureAwait(false);

        if (record.Status is PluginStatus.Active or PluginStatus.Misconfigured or PluginStatus.Failed)
        {
            await ReloadAsync(id, cancellationToken).ConfigureAwait(false);
        }

        Changed?.Invoke();
    }

    /// <summary>Ends a plugin's instance and builds another from the same configuration.</summary>
    public async Task ReloadAsync(string id, CancellationToken cancellationToken = default)
    {
        if (!Enabled(id))
        {
            return;
        }

        await StopOneAsync(id).ConfigureAwait(false);
        Replace(id, current => current with { Status = PluginStatus.Discovered, Error = null });
        await StartOneAsync(id, cancellationToken).ConfigureAwait(false);

        Changed?.Invoke();
    }

    /// <summary>
    /// Every running plugin that can do a particular thing.
    /// </summary>
    /// <remarks>
    /// The only way anything asks a plugin for anything: by what it can do rather than by name, so
    /// nothing outside this file has to know which plugins exist.
    /// </remarks>
    public IEnumerable<T> Capabilities<T>()
        where T : class =>
        Records
            .Where(record => record.Status == PluginStatus.Active)
            .Select(record => record.Instance)
            .OfType<T>();

    /// <summary>What a plugin has said about itself, oldest first.</summary>
    public IReadOnlyList<PluginLogEntry> LogFor(string id) =>
        _hosts.TryGetValue(id, out var host) ? host.Lines : [];

    /// <summary>
    /// Writes a line into a plugin's own log on its behalf.
    /// </summary>
    /// <remarks>
    /// For what the HOST noticed about a plugin: a call that threw, an answer that made no sense.
    /// It belongs beside what the plugin said about itself rather than in a log of its own, because
    /// somebody asking why their speaker is not listed wants one place to look.
    /// </remarks>
    public void Note(string id, string message)
    {
        if (_hosts.TryGetValue(id, out var host))
        {
            host.Logger.Warn(message);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        foreach (var id in Records.Select(record => record.Id).ToList())
        {
            await StopOneAsync(id).ConfigureAwait(false);
        }

        foreach (var gate in _oneAtATime.Values)
        {
            gate.Dispose();
        }

        _oneAtATime.Clear();
    }

    /// <summary>
    /// Whether a plugin runs, when nobody has said either way.
    /// </summary>
    /// <remarks>
    /// A bundled plugin is on, because shipping it is the decision to have it and an operator who
    /// never opens the settings page should still be able to play on their speaker. A plugin
    /// somebody dropped into the folder themselves is off until they say otherwise: code that
    /// arrived without being asked for should not start itself, even on a machine where the person
    /// who put it there is also the person running the app.
    /// </remarks>
    private static bool OnByDefault(PluginOrigin origin) => origin == PluginOrigin.Bundled;

    /// <summary>
    /// What is stored for a plugin, or what would be stored if somebody wrote it down now.
    /// </summary>
    /// <remarks>
    /// The default MATTERS, and getting it wrong is how a bundled plugin quietly switched itself off
    /// the first time anybody saved its configuration: an absent entry is not "disabled", it is
    /// "nobody has said", and the answer to that depends on where the plugin came from. Writing
    /// <c>Enabled = false</c> into the file at that moment would turn a question into a decision the
    /// operator never made, in the same breath as a change they did.
    /// </remarks>
    private PluginSettings Existing(DesktopSettings settings, string id) =>
        settings.Plugins.TryGetValue(id, out var stored)
            ? stored
            : new PluginSettings { Enabled = Find(id) is { } record && OnByDefault(record.Origin) };

    /// <summary>Folds what the operator decided into what was found on disk.</summary>
    private PluginRecord WithDecision(PluginRecord record)
    {
        if (record.Status == PluginStatus.Failed)
        {
            return record;
        }

        var enabled = settings.Current.Plugins.TryGetValue(record.Id, out var stored)
            ? stored.Enabled
            : OnByDefault(record.Origin);

        return enabled ? record : record with { Status = PluginStatus.Disabled };
    }

    private bool Enabled(string id) =>
        settings.Current.Plugins.TryGetValue(id, out var stored)
            ? stored.Enabled
            : Find(id) is { } record && OnByDefault(record.Origin);

    private PluginRecord? Find(string id)
    {
        lock (_records)
        {
            return _all.Find(record => record.Id == id);
        }
    }

    private void Replace(string id, Func<PluginRecord, PluginRecord> change)
    {
        lock (_records)
        {
            var index = _all.FindIndex(record => record.Id == id);

            if (index >= 0)
            {
                _all[index] = change(_all[index]);
            }
        }
    }

    private SemaphoreSlim GateFor(string id)
    {
        lock (_records)
        {
            if (!_oneAtATime.TryGetValue(id, out var gate))
            {
                gate = new SemaphoreSlim(1, 1);
                _oneAtATime[id] = gate;
            }

            return gate;
        }
    }

    /// <summary>
    /// Builds and starts one plugin, and turns anything that goes wrong into its record.
    /// </summary>
    /// <remarks>
    /// Serialised per plugin, because a configuration save that lands while a start is still running
    /// would otherwise produce two live instances of one plugin and dispose neither.
    /// </remarks>
    private async Task StartOneAsync(string id, CancellationToken cancellationToken)
    {
        var gate = GateFor(id);
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            if (Find(id) is not { Status: PluginStatus.Discovered, Manifest: { } manifest } discovered)
            {
                return;
            }

            var config = ConfigFor(manifest, settings.Current);
            var missing = manifest.ConfigFields
                .Where(field => field.Required && !config.ContainsKey(field.Key))
                .Select(field => field.Label)
                .ToList();

            if (missing.Count > 0)
            {
                // Misconfigured rather than failed: nothing is broken, something has not been filled
                // in, and those want different sentences and different buttons.
                Replace(id, current => current with
                {
                    Status = PluginStatus.Misconfigured,
                    Error = string.Create(CultureInfo.InvariantCulture, $"it needs {string.Join(" and ", missing)}."),
                });
                return;
            }

            var activated = loader.Activate(discovered);

            if (activated.Instance is not { } instance)
            {
                Replace(id, _ => activated);
                return;
            }

            var host = new PluginHost(id, config, clock);
            _hosts[id] = host;

            try
            {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, host.Shutdown);
                deadline.CancelAfter(_startDeadline);

                await instance.InitializeAsync(host, deadline.Token).ConfigureAwait(false);
                Replace(id, _ => activated);
            }
            catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
            {
                // A half-built plugin is disposed rather than left holding whatever it opened before
                // it gave up. Its own dispose may throw too, and that is not a second failure worth
                // reporting over the first.
                await SafeDisposeAsync(instance).ConfigureAwait(false);
                host.Dispose();
                _hosts.Remove(id);

                var why = error is OperationCanceledException && !cancellationToken.IsCancellationRequested
                    ? string.Create(CultureInfo.InvariantCulture, $"it did not finish starting within {_startDeadline.TotalSeconds:0} seconds.")
                    : error.Message;

                Replace(id, current => current with { Status = PluginStatus.Failed, Error = why, Instance = null });
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task StopOneAsync(string id)
    {
        var gate = GateFor(id);
        await gate.WaitAsync().ConfigureAwait(false);

        try
        {
            if (_hosts.Remove(id, out var host))
            {
                // Told before anything is taken away, so a plugin's own loops can stop rather than
                // discover their client disposed underneath them.
                host.RequestShutdown();

                if (Find(id)?.Instance is { } instance)
                {
                    await SafeDisposeAsync(instance).ConfigureAwait(false);
                }

                host.Dispose();
            }

            Replace(id, current => current with { Instance = null });
        }
        finally
        {
            gate.Release();
        }
    }

    private static async Task SafeDisposeAsync(IAsyncDisposable instance)
    {
        try
        {
            await instance.DisposeAsync().ConfigureAwait(false);
        }
        catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
        {
            // Nothing can be done about a plugin that throws on the way out, and letting it through
            // would stop the plugins after it from being disposed at all.
        }
    }

    /// <summary>
    /// The values a plugin sees: what was saved, with declared defaults filling the gaps.
    /// </summary>
    /// <remarks>
    /// A field with neither is absent rather than empty, so a plugin can tell "not set" from "set to
    /// nothing" without a sentinel.
    /// </remarks>
    private static Dictionary<string, string> ConfigFor(PluginManifest manifest, DesktopSettings settings)
    {
        var saved = settings.Plugins.TryGetValue(manifest.Id, out var stored)
            ? stored.Config
            : new Dictionary<string, string>(StringComparer.Ordinal);

        var config = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var field in manifest.ConfigFields)
        {
            if (field.Type == PluginConfigFieldType.Note)
            {
                continue;
            }

            if (saved.TryGetValue(field.Key, out var value) && !string.IsNullOrEmpty(value))
            {
                config[field.Key] = value;
            }
            else if (!string.IsNullOrEmpty(field.Default))
            {
                config[field.Key] = field.Default;
            }
        }

        return config;
    }
}
