using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Output;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>
/// The plugins, as somewhere to play.
/// </summary>
/// <remarks>
/// The one place the app's own idea of an output meets a plugin's. It asks by capability rather than
/// by name, so nothing here knows that BluOS exists, and a plugin that answers badly costs its own
/// devices rather than everybody's.
/// </remarks>
public sealed class PluginOutputSource(PluginManager plugins) : IOutputSource
{
    public async Task<IReadOnlyList<Output>> DiscoverAsync(CancellationToken cancellationToken)
    {
        var outputs = new List<Output>();

        foreach (var record in Providers())
        {
            try
            {
                var devices = await record.Provider.DiscoverAsync(cancellationToken).ConfigureAwait(false);

                outputs.AddRange(devices.Select(device => new Output(
                    record.Id,
                    device.Id,
                    device.Name,
                    device.Model,
                    device.Address)));
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
            {
                // One plugin failing to look is one plugin's devices missing from the picker, not an
                // empty picker. A plugin is trusted code and still not code this app wrote.
                plugins.Note(record.Id, $"could not be asked for players: {error.Message}");
            }
        }

        return outputs;
    }

    public IStationPlayer? Open(Output output)
    {
        ArgumentNullException.ThrowIfNull(output);

        var owner = Providers().FirstOrDefault(record => record.Id == output.PluginId);

        if (owner is null)
        {
            // Switched off, reloaded, or removed since the picker was drawn.
            return null;
        }

        try
        {
            return owner.Provider.CreatePlayer(new OutputDevice(
                output.DeviceId,
                output.Name,
                output.Model,
                output.Address));
        }
        catch (Exception error) when (error is not OutOfMemoryException and not StackOverflowException)
        {
            plugins.Note(output.PluginId, $"could not open {output.Name}: {error.Message}");
            return null;
        }
    }

    private List<Owned> Providers() =>
    [
        .. plugins.Records
            .Where(record => record.Status == PluginStatus.Active)
            .Select(record => new { record.Id, Provider = record.Instance as IOutputTargetProvider })
            .Where(record => record.Provider is not null)
            .Select(record => new Owned(record.Id, record.Provider!)),
    ];

    private sealed record Owned(string Id, IOutputTargetProvider Provider);
}
