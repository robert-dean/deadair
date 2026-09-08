using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One plugin on the settings page: what it is, whether it runs, and what it can be told.
/// </summary>
/// <remarks>
/// A plugin that could not be loaded is still a row. Its name, where it came from and what went
/// wrong are the whole of what somebody has to work with, and leaving it out would answer "why is my
/// speaker not there" with an empty list.
/// </remarks>
public sealed partial class PluginRowViewModel : ObservableObject
{
    private readonly IPluginCatalog _catalog;
    private bool _settingUp;

    public PluginRowViewModel(PluginInfo plugin, IPluginCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(plugin);

        _catalog = catalog;
        _settingUp = true;

        Id = plugin.Id;
        Name = plugin.Name;
        Version = plugin.Version;
        Origin = plugin.Origin;
        Problem = plugin.Problem;
        Log = plugin.Log;

        Fields =
        [
            .. plugin.Fields.Select(field => SettingFieldViewModel.ForPlugin(
                field,
                plugin.Values.TryGetValue(field.Key, out var value) ? value : null)),
        ];

        Enabled = plugin.Enabled;
        _settingUp = false;
    }

    public string Id { get; }

    public string Name { get; }

    public string Version { get; }

    public string Origin { get; }

    /// <summary>Why it is not working, when it is not.</summary>
    public string? Problem { get; }

    public bool HasProblem => Problem is not null;

    /// <summary>The last few lines it wrote, shown while it is running and has said something.</summary>
    public IReadOnlyList<string> Log { get; }

    public bool HasLog => Log.Count > 0;

    public IReadOnlyList<SettingFieldViewModel> Fields { get; }

    public bool HasFields => Fields.Count > 0;

    /// <summary>Saved the moment it is moved, like the appearance rather than like the station.</summary>
    [ObservableProperty]
    private bool _enabled;

    [ObservableProperty]
    private string? _notice;

    partial void OnEnabledChanged(bool value)
    {
        if (_settingUp)
        {
            return;
        }

        Notice = null;
        _ = _catalog.SetEnabledAsync(Id, value);
    }

    /// <summary>
    /// Sends what changed, and starts the plugin again with it.
    /// </summary>
    /// <remarks>
    /// Everything is sent rather than only what is dirty, unlike the station's own settings: this
    /// file is the app's, nobody else is editing it, and a plugin reads the whole of its
    /// configuration when it starts.
    /// </remarks>
    [RelayCommand]
    private async Task SaveAsync()
    {
        if (!Fields.Any(field => field.IsDirty))
        {
            Notice = "Nothing has changed.";
            return;
        }

        await _catalog.SaveAsync(
            Id,
            Fields.ToDictionary(field => field.Key, field => field.Current, StringComparer.Ordinal))
            .ConfigureAwait(true);

        Notice = "Saved.";
    }
}
