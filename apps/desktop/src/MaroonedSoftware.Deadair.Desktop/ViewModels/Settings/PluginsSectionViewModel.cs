using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// Switching a station plugin on or off, from its row or its page, with the one question that goes
/// with the first time.
/// </summary>
/// <remarks>
/// Plugins are trusted code: one runs inside the station's own process with the station's own
/// privileges, and what it declares is a description rather than a limit. So the enable that actually
/// extends that trust, the plugin's first, asks first and says so, as the console's trust dialog does.
/// Later enables do not ask again, because the decision was already made.
/// </remarks>
public static class StationPluginSwitch
{
    public static Task<PluginDetail?> SetAsync(SettingsCalls calls, PluginSummary plugin, bool enabled)
    {
        ArgumentNullException.ThrowIfNull(plugin);
        return SetAsync(calls, plugin.Id, plugin.Name, plugin.FirstEnabledAt, plugin.Capabilities, enabled);
    }

    public static Task<PluginDetail?> SetAsync(SettingsCalls calls, PluginDetail plugin, bool enabled)
    {
        ArgumentNullException.ThrowIfNull(plugin);
        return SetAsync(calls, plugin.Id, plugin.Name, plugin.FirstEnabledAt, plugin.Capabilities, enabled);
    }

    private static async Task<PluginDetail?> SetAsync(
        SettingsCalls calls,
        string id,
        string name,
        DateTimeOffset? firstEnabledAt,
        IReadOnlyList<string> capabilities,
        bool enabled)
    {
        ArgumentNullException.ThrowIfNull(calls);

        if (enabled && firstEnabledAt is null
            && !await calls.Dialogs.ConfirmAsync(
                $"Enable {name}?",
                Trust(name, capabilities),
                $"Enable {name}",
                destructive: false).ConfigureAwait(true))
        {
            return null;
        }

        return await calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = calls.Sdk();
                return enabled
                    ? await sdk.Plugins.EnablePluginAsync(id, token).ConfigureAwait(false)
                    : await sdk.Plugins.DisablePluginAsync(id, token).ConfigureAwait(false);
            }).ConfigureAwait(true);
    }

    /// <summary>What the first enable says, in the console's words.</summary>
    public static string Trust(string name, IReadOnlyList<string> capabilities)
    {
        ArgumentNullException.ThrowIfNull(capabilities);

        var declared = capabilities.Count == 0 ? string.Empty : $" It declares: {string.Join(", ", capabilities.Select(PluginRoles.Label))}.";
        return $"Plugins are trusted code. {name} runs inside the deadair server process with the server's own privileges: it can read and "
            + "write your files, open network connections to anywhere, and read the server's environment, including database and encryption "
            + "credentials. The permissions a plugin declares are a description of what it says it needs, not a limit on what it can do. "
            + $"Enable it the way you would add a dependency: because you trust who wrote it.{declared}";
    }
}

/// <summary>One station plugin in the list: what it is, how it is, and its switch.</summary>
public sealed partial class StationPluginRowViewModel : ObservableObject
{
    private readonly Func<StationPluginRowViewModel, bool, Task> _toggle;
    private bool _enabled;

    public StationPluginRowViewModel(PluginSummary summary, Func<StationPluginRowViewModel, bool, Task> toggle)
    {
        ArgumentNullException.ThrowIfNull(summary);

        Summary = summary;
        _toggle = toggle;
        _enabled = summary.Enabled;
    }

    public PluginSummary Summary { get; }

    public string Name => Summary.Name;

    public string Version => Summary.Version;

    public string Initial => Summary.Name.Length > 0 ? char.ToUpperInvariant(Summary.Name[0]).ToString() : "?";

    public string Description => PluginRoles.FirstLine(Summary.Description) is { Length: > 0 } line ? line : "No description.";

    /// <summary>What it does, in the station's words rather than the manifest's.</summary>
    public string Does => string.Join(" · ", Summary.Capabilities.Where(capability => capability != PluginRoles.OAuth).Select(PluginRoles.Label));

    public string Status => PluginStatusWords.Label(Summary.Status);

    public StatusTone Tone => PluginStatusWords.Tone(Summary.Status);

    /// <summary>Added to this station by hand rather than shipped with it, which is the only kind that can be removed.</summary>
    public bool IsInstalled => Summary.Origin == PluginOrigin.Installed;

    /// <summary>
    /// The switch. Setting it asks the station, and a refusal or a declined trust question puts it back.
    /// </summary>
    public bool Enabled
    {
        get => _enabled;
        set
        {
            if (SetProperty(ref _enabled, value) && value != Summary.Enabled)
            {
                _ = _toggle(this, value);
            }
        }
    }

    /// <summary>Puts the switch back where the station has it.</summary>
    public void Revert()
    {
        _enabled = Summary.Enabled;
        OnPropertyChanged(nameof(Enabled));
    }
}

/// <summary>The plugins under one heading.</summary>
public sealed record StationPluginGroupViewModel(string Title, IReadOnlyList<StationPluginRowViewModel> Plugins);

/// <summary>
/// The plugins the station runs, by what they are for: the console's Plugins page, as a section.
/// </summary>
/// <remarks>
/// <para>
/// These are the STATION's plugins, running in the station, and they are named so everywhere on the
/// page. This app's own extensions (somewhere else to play the station) are a different thing that
/// happens to share the word, and they stay on this app's card.
/// </para>
/// <para>
/// A row opens the plugin's own page, where it is configured, connected and read; the list carries
/// only what is decided from a glance: whether it is on.
/// </para>
/// </remarks>
public sealed partial class PluginsSectionViewModel(SettingsCalls calls, Action<PluginSummary> open) : ObservableObject, ISettingsSectionContent
{
    public ObservableCollection<StationPluginGroupViewModel> Groups { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEmpty))]
    private bool _loaded;

    [ObservableProperty]
    private string _summary = string.Empty;

    [ObservableProperty]
    private string? _notice;

    public bool IsEmpty => Loaded && Groups.Count == 0;

    public bool IsDirty => false;

    public void Shown() => LoadCommand.Execute(null);

    public void Reset()
    {
        Groups.Clear();
        Loaded = false;
        Notice = null;
        Summary = string.Empty;
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var plugins = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();
                    return await sdk.Plugins.ListPluginsAsync(token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (plugins is not null)
            {
                Present(plugins);
            }
        }
        finally
        {
            Busy = false;
        }
    }

    public void Present(IReadOnlyList<PluginSummary> plugins)
    {
        ArgumentNullException.ThrowIfNull(plugins);

        Groups.Clear();
        foreach (var group in PluginRoles.Group(plugins))
        {
            Groups.Add(new StationPluginGroupViewModel(
                group.Role.Title.ToUpperInvariant(),
                [.. group.Plugins.Select(plugin => new StationPluginRowViewModel(plugin, ToggleAsync))]));
        }

        var attention = plugins.Count(plugin => PluginRoles.NeedsAttention(plugin.Status));
        Summary = attention switch
        {
            0 => $"{plugins.Count} installed",
            1 => $"{plugins.Count} installed · 1 needs attention",
            _ => $"{plugins.Count} installed · {attention} need attention",
        };

        Loaded = true;
        OnPropertyChanged(nameof(IsEmpty));
    }

    [RelayCommand]
    private void Open(StationPluginRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);
        open(row.Summary);
    }

    private async Task ToggleAsync(StationPluginRowViewModel row, bool enabled)
    {
        var detail = await StationPluginSwitch.SetAsync(calls, row.Summary, enabled).ConfigureAwait(true);
        if (detail is null)
        {
            row.Revert();
            return;
        }

        await LoadAsync(CancellationToken.None).ConfigureAwait(true);
    }

    /// <summary>Asks the station to look in its plugins folder again, for one somebody copied there by hand.</summary>
    [RelayCommand]
    private async Task RescanAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var plugins = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();
                    return await sdk.Plugins.RescanPluginsAsync(token).ConfigureAwait(false);
                },
                new Dictionary<int, string> { [403] = "Rescanning the plugin directory is an administrator action." },
                cancellationToken).ConfigureAwait(true);

            if (plugins is not null)
            {
                Present(plugins);
                Notice = "Looked in the plugins folder again.";
            }
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Sends the station a plugin somebody chose, the tarball <c>npm pack</c> writes.</summary>
    /// <remarks>
    /// The question comes after the file is chosen so it can name it, and it is asked at all because
    /// the station reads what a plugin is by LOADING its code, as a rescan does. It arrives switched
    /// off, so nothing about the station changes until somebody enables it.
    /// </remarks>
    [RelayCommand]
    private async Task ImportAsync(CancellationToken cancellationToken)
    {
        if (calls.Files is not { } files
            || await files.OpenAsync("A plugin to import", ["*.tgz", "*.tar.gz"]).ConfigureAwait(true) is not { } picked)
        {
            return;
        }

        if (!await calls.Dialogs.ConfirmAsync(
                $"Import {picked.Name}?",
                "Only import a plugin from somebody you trust: the station reads what it is by loading its code, as a rescan does. It arrives "
                + "switched off, and nothing about the station changes until you enable it. A newer version of a plugin you already have "
                + "replaces it and keeps its settings.",
                "Import",
                destructive: false).ConfigureAwait(true))
        {
            return;
        }

        Busy = true;
        try
        {
            var result = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();
                    return await sdk.Plugins.ImportPluginAsync(
                        [SdkPart.File("file", picked.Data, picked.Name, "application/gzip")],
                        token).ConfigureAwait(false);
                },
                new Dictionary<int, string> { [403] = "Importing a plugin is an administrator action." },
                cancellationToken).ConfigureAwait(true);

            if (result is null)
            {
                return;
            }

            Present(result.Plugins);
            var name = result.Plugins.FirstOrDefault(plugin => plugin.Id == result.PluginId)?.Name ?? result.PluginId;
            Notice = result.RestartRequired
                ? $"{name} imported. This version was already loaded, so the station keeps running the build it had until it restarts; "
                    + "to load a new build without a restart, give it a new version number."
                : $"{name} imported. It stays off until you enable it.";
        }
        finally
        {
            Busy = false;
        }
    }
}
