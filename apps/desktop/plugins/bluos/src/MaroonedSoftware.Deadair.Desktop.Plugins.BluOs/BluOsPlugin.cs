using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Discovery;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Http;
using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;
using MaroonedSoftware.Deadair.Desktop.PluginSdk;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs;

/// <summary>
/// Somewhere else to play the station: a Bluesound, NAD or Dali player on this network.
/// </summary>
/// <remarks>
/// <para>
/// The player fetches the audio itself, so nothing about the sound passes through this app. What
/// this does is find the players, hand one a mount, and drive its transport.
/// </para>
/// <para>
/// The display is deliberately not part of it. That question was probed against this exact hardware
/// and closed: a station added as a custom URL gets one line of text on the player, permanently,
/// because Icecast flattens the title and artist into one field and the format carries no image at
/// all. See <c>docs/todo/now-playing-displays.md</c>. The caption and logo settings write the two
/// slots that ARE writable, once, and both are about the station rather than about a record.
/// </para>
/// </remarks>
public sealed class BluOsPlugin : IDeadairPlugin, IOutputTargetProvider
{
    /// <summary>What the manifest calls this.</summary>
    public const string Id = "deadair.bluos";

    private IPluginHost? _host;
    private BluOsSettings _settings = new(Discover: true, Players: [], Caption: null, Logo: null);

    public Task InitializeAsync(IPluginHost host, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(host);

        _host = host;
        _settings = BluOsConfig.Read(host.Config, host.Logger);

        host.Logger.Info(_settings.Discover
            ? $"looking for players on the network, plus {_settings.Players.Count} address(es) written down"
            : $"not looking for players; using the {_settings.Players.Count} address(es) written down");

        return Task.CompletedTask;
    }

    /// <summary>
    /// Every player worth offering: the ones that answered, and the ones somebody typed in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A typed address wins over a discovered one at the same place, because somebody wrote it down
    /// on purpose and because it is the one that will still be there when the network stops carrying
    /// broadcasts.
    /// </para>
    /// <para>
    /// A typed player is ASKED WHAT IT IS, rather than listed as a bare address. It is one request
    /// to a machine the operator named, and the difference on the picker is between "Office" and
    /// "192.0.2.36". A player that does not answer is still listed: it may be switched off tonight,
    /// and leaving it out would make the operator's own list disappear when they most want to see
    /// why it is not working.
    /// </para>
    /// </remarks>
    public async Task<IReadOnlyList<OutputDevice>> DiscoverAsync(CancellationToken cancellationToken)
    {
        var host = _host ?? throw new InvalidOperationException("the plugin was asked for players before it was started");
        var found = new List<OutputDevice>();

        if (_settings.Discover)
        {
            try
            {
                var announcements = await new LsdpDiscovery(host.Clock, host.Logger).ListenAsync(cancellationToken).ConfigureAwait(false);
                found.AddRange(LsdpDevices.From(announcements, Id));
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
            {
                // A network that will not carry a broadcast is a network, not a fault. Whatever was
                // written down by hand is still worth offering.
                host.Logger.Warn("could not ask the network for players", error);
            }
        }

        var devices = new List<OutputDevice>();

        foreach (var endpoint in _settings.Players)
        {
            devices.Add(await AskAsync(host, endpoint, cancellationToken).ConfigureAwait(false));
        }

        // Discovered players that nobody wrote down, in the order they came back.
        devices.AddRange(found.Where(device => !devices.Any(typed => typed.Address == device.Address)));

        host.Logger.Info($"offering {devices.Count} player(s)");

        return devices;
    }

    public IStationPlayer CreatePlayer(OutputDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);

        var host = _host ?? throw new InvalidOperationException("the plugin was asked for a player before it was started");

        // The address rather than the id, and no network work: the host may build several of these
        // while somebody is deciding, and the device may be one this plugin never discovered — a
        // remembered choice from last week, or an address typed by hand.
        var endpoint = BluOsEndpoint.Parse(device.Address);

        return new BluOsStationPlayer(
            new BluOsClient(host.Http, endpoint, host.Logger),
            _settings,
            host.Clock,
            host.Logger);
    }

    public ValueTask DisposeAsync()
    {
        _host = null;
        return ValueTask.CompletedTask;
    }

    private static async Task<OutputDevice> AskAsync(IPluginHost host, BluOsEndpoint endpoint, CancellationToken cancellationToken)
    {
        try
        {
            var sync = await new BluOsClient(host.Http, endpoint, host.Logger)
                .SyncStatusAsync(cancellationToken)
                .ConfigureAwait(false);

            return new OutputDevice(
                sync.Mac?.ToLowerInvariant() ?? endpoint.ToString(),
                sync.Name ?? endpoint.Host,
                sync.ModelName ?? sync.Model,
                endpoint.ToString());
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
        {
            host.Logger.Warn($"{endpoint} did not answer, and is being offered anyway", error);

            // Its address is its id as well as its name. A player that is switched off tonight is on
            // again tomorrow, and it has to keep the same id across both or a remembered choice
            // would stop matching it.
            return new OutputDevice(endpoint.ToString(), endpoint.Host, null, endpoint.ToString());
        }
    }
}
