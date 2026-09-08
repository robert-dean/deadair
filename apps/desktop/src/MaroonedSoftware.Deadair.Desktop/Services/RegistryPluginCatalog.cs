using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Manifest;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>
/// The plugin manager, as the settings page sees it.
/// </summary>
/// <remarks>
/// The one place the app's own idea of a plugin's settings meets the contract's. It also puts the
/// two operations in the right order: a plugin's device is let go of BEFORE the plugin is switched
/// off or started again, so the speaker is stopped by the plugin that owns it while that plugin is
/// still there to stop it.
/// </remarks>
public sealed class RegistryPluginCatalog(
    PluginManager plugins,
    OutputCatalog outputs,
    ISettingsStore settings) : IPluginCatalog
{
    public IReadOnlyList<PluginInfo> Plugins =>
    [
        .. plugins.Records.Select(record => new PluginInfo(
            record.Id,
            record.DisplayName,
            record.Manifest?.Version ?? string.Empty,
            record.Origin == PluginOrigin.Bundled ? "Bundled" : "Installed",
            record.Status is not (PluginStatus.Disabled or PluginStatus.Failed) || Stored(record.Id)?.Enabled == true,
            Fields(record.Manifest),
            Stored(record.Id)?.Config ?? new Dictionary<string, string>(StringComparer.Ordinal),
            record.Error,
            [.. plugins.LogFor(record.Id).TakeLast(6).Select(line => string.Create(CultureInfo.CurrentCulture, $"{line.At.ToLocalTime():HH:mm}  {line.Message}"))])),
    ];

    public event Action? Changed
    {
        add => plugins.Changed += value;
        remove => plugins.Changed -= value;
    }

    public async Task SetEnabledAsync(string id, bool enabled, CancellationToken cancellationToken = default)
    {
        // Before, not after. A speaker this plugin is driving has to be stopped by this plugin, and
        // in a moment there will not be one.
        await outputs.ReleasePluginAsync(id, cancellationToken).ConfigureAwait(false);
        await plugins.SetEnabledAsync(id, enabled, cancellationToken).ConfigureAwait(false);

        if (enabled)
        {
            await outputs.RescanAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public async Task SaveAsync(string id, IReadOnlyDictionary<string, string> values, CancellationToken cancellationToken = default)
    {
        await outputs.ReleasePluginAsync(id, cancellationToken).ConfigureAwait(false);
        await plugins.SaveConfigAsync(id, values, cancellationToken).ConfigureAwait(false);
        await outputs.RescanAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// What the form can draw, out of what the manifest declared.
    /// </summary>
    /// <remarks>
    /// A note is dropped rather than drawn as an empty box, and a select is drawn as a line for now:
    /// the alternative is a plugin whose settings screen has a hole in it, and a line an operator can
    /// type the value into is worse than a menu and better than nothing.
    /// </remarks>
    private static List<FieldSpec> Fields(PluginManifest? manifest) =>
    [
        .. (manifest?.ConfigFields ?? [])
            .Where(field => field.Type != PluginConfigFieldType.Note)
            .Select(field => new FieldSpec(
                field.Key,
                field.Label,
                field.Help,
                field.Type switch
                {
                    PluginConfigFieldType.Boolean => FieldKind.Boolean,
                    PluginConfigFieldType.Text => FieldKind.Text,
                    _ => FieldKind.Line,
                },
                field.Default)),
    ];

    private PluginSettings? Stored(string id) =>
        settings.Current.Plugins.TryGetValue(id, out var stored) ? stored : null;
}
