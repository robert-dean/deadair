using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Themes;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One group of the station's settings, as the station groups them.</summary>
public sealed record SettingGroupViewModel(string Name, IReadOnlyList<SettingFieldViewModel> Fields);

/// <summary>
/// One way to listen, and whether the station is publishing it.
/// </summary>
/// <remarks>
/// An unpublished format is drawn and DISABLED rather than hidden, which is the rule the Android
/// listener arrived at: a FLAC row that vanishes tells somebody who wants FLAC nothing, while one
/// they cannot choose tells them the station is not offering it. Which is which comes from
/// <c>mounts[]</c> on the last reading and never from trying a mount — a connection of any length
/// registers an audience for the full five-minute linger.
/// </remarks>
public sealed partial class FormatChoiceViewModel(NowPlayingMountFormat format, string label) : ObservableObject
{
    public NowPlayingMountFormat Format { get; } = format;

    public string Label { get; } = label;

    [ObservableProperty]
    private bool _isAvailable;

    [ObservableProperty]
    private bool _isChosen;

    /// <summary>The rate, when the station published one for this format.</summary>
    [ObservableProperty]
    private string _detail = string.Empty;
}

/// <summary>
/// The station's settings, and this app's own.
/// </summary>
/// <remarks>
/// <para>
/// The station's half is drawn entirely from what it declares, so a setting added there appears here
/// with no code. The app's half is Appearance, which is local to this install and never leaves it.
/// </para>
/// <para>
/// Only what CHANGED is sent. A partial write is what the endpoint takes, and sending everything back
/// would overwrite a value somebody else edited while this page was open.
/// </para>
/// </remarks>
public sealed partial class SettingsViewModel(
    OperatorActions actions,
    HttpClient http,
    ISettingsStore settings,
    ThemeManager themes,
    IPluginCatalog? plugins = null) : ObservableObject
{
    private StationUrl _station;

    public ObservableCollection<SettingGroupViewModel> Groups { get; } = [];

    /// <summary>What this install has been given beyond what it shipped with.</summary>
    public ObservableCollection<PluginRowViewModel> Plugins { get; } = [];

    public bool HasPlugins => Plugins.Count > 0;

    /// <summary>Where to put one, said only when there are none to list.</summary>
    /// <remarks>
    /// The path rather than a sentence about plugins in general: somebody reading this has already
    /// decided they want one, and what they do not have is the folder.
    /// </remarks>
    public static string PluginsFolder { get; } =
        $"None installed. Put one in {PluginDirectories.Default().User} and start the app again.";

    /// <summary>What this install looks like: the system's choice, or one made here.</summary>
    /// <remarks>
    /// Applied at once and remembered, because an appearance somebody has to press Save to see is an
    /// appearance they cannot judge. Save is for the STATION's settings; this one is local and never
    /// leaves the machine.
    /// </remarks>
    [ObservableProperty]
    private Appearance _appearance = Appearance.System;

    /// <summary>
    /// Whether the system's Next control (media keys, Control Centre) is offered to the operator.
    /// </summary>
    /// <remarks>
    /// Off by default, saved at once like <see cref="Appearance"/>. The button itself is offered only
    /// while the signed-in account is the operator; this is the second half of that gate, because a
    /// system Next key skips the record for every listener with no second press to reconsider.
    /// </remarks>
    [ObservableProperty]
    private bool _nextSkips;

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _notice;

    /// <summary>Every format the station could publish, in the order a listener would try them.</summary>
    public IReadOnlyList<FormatChoiceViewModel> Formats { get; } =
    [
        new(NowPlayingMountFormat.Mp3, MountLabel.Name(NowPlayingMountFormat.Mp3)),
        new(NowPlayingMountFormat.Aac, MountLabel.Name(NowPlayingMountFormat.Aac)),
        new(NowPlayingMountFormat.Opus, MountLabel.Name(NowPlayingMountFormat.Opus)),
        new(NowPlayingMountFormat.Flac, MountLabel.Name(NowPlayingMountFormat.Flac)),
        new(NowPlayingMountFormat.Hls, MountLabel.Name(NowPlayingMountFormat.Hls)),
    ];

    /// <summary>Fills the extensions card, and follows the plugins as they start and stop.</summary>
    public void AttachPlugins()
    {
        if (plugins is null)
        {
            return;
        }

        plugins.Changed += RefreshPlugins;
        RefreshPlugins();
    }

    private void RefreshPlugins()
    {
        if (plugins is null)
        {
            return;
        }

        // Rebuilt rather than updated in place. A plugin's row is small, the list changes only when
        // somebody presses something, and a row is the thing that carries whether its own fields
        // have been edited — reconciling that against a fresh reading would be more code than this
        // page has any use for.
        Plugins.Clear();

        foreach (var plugin in plugins.Plugins)
        {
            Plugins.Add(new PluginRowViewModel(plugin, plugins));
        }

        OnPropertyChanged(nameof(HasPlugins));
    }

    public void Attach(StationUrl station)
    {
        _station = station;
        Appearance = settings.Current.Appearance;
        NextSkips = settings.Current.NextSkips;
        MarkChosenFormat(settings.Current.Format);
    }

    /// <summary>
    /// Says which formats are really on offer, from a reading somebody else already took.
    /// </summary>
    /// <remarks>
    /// Handed the mounts rather than fetching them: this page has no business asking `/nowplaying`
    /// when the listener half of the app is already subscribed to it, and it must never ask a MOUNT.
    /// </remarks>
    public void ApplyMounts(IReadOnlyList<NowPlayingMount> mounts)
    {
        ArgumentNullException.ThrowIfNull(mounts);

        foreach (var choice in Formats)
        {
            var published = mounts.FirstOrDefault(mount => mount.Format == choice.Format);

            choice.IsAvailable = published is not null;
            choice.Detail = published is null
                ? string.Empty
                : MountLabel.Of(published).Replace(choice.Label, string.Empty, StringComparison.Ordinal).Trim();
        }
    }

    /// <remarks>
    /// Saved at once like the appearance, and for the same reason: Save is the STATION's button. What
    /// it does not do is reconnect — the change lands on the next Listen, because dropping a live
    /// connection to pick up a new one is a second audience on a gated station.
    /// </remarks>
    [RelayCommand]
    private async Task ChooseFormatAsync(FormatChoiceViewModel choice)
    {
        ArgumentNullException.ThrowIfNull(choice);

        MarkChosenFormat(choice.Format);
        await settings.UpdateAsync(current => current with { Format = choice.Format }).ConfigureAwait(true);
    }

    private void MarkChosenFormat(NowPlayingMountFormat chosen)
    {
        foreach (var choice in Formats)
        {
            choice.IsChosen = choice.Format == chosen;
        }
    }

    partial void OnAppearanceChanged(Appearance value)
    {
        themes.Apply(value);
        _ = settings.UpdateAsync(current => current with { Appearance = value });
    }

    partial void OnNextSkipsChanged(bool value) => _ = settings.UpdateAsync(current => current with { NextSkips = value });

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        Notice = null;

        try
        {
            var station = await actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();
                    return await sdk.Settings.GetSettingsAsync(token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (station is null)
            {
                return;
            }

            Groups.Clear();
            foreach (var group in station.Descriptors.GroupBy(descriptor => descriptor.Group))
            {
                var fields = group
                    .Select(descriptor => new SettingFieldViewModel(
                        descriptor,
                        station.Values.TryGetValue(descriptor.Key, out var value) ? value : null,
                        station.Configured.TryGetValue(descriptor.Key, out var configured) && configured))
                    .ToList();

                Groups.Add(new SettingGroupViewModel(Title(group.Key.ToString()), fields));
            }
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        var changed = Groups
            .SelectMany(group => group.Fields)
            .Where(field => field.IsDirty)
            .ToDictionary(
                field => field.Key,

                // Every value travels as a string: every layer of the station's configuration holds
                // text, so a JSON boolean would be a shape it does not store.
                field => JsonSerializer.SerializeToElement(field.Current));

        if (changed.Count == 0)
        {
            Notice = "Nothing has changed.";
            return;
        }

        Busy = true;
        try
        {
            var saved = await actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();

                    // Partial: sending everything back would overwrite a value somebody else changed
                    // while this page was open.
                    return await sdk.Settings.UpdateSettingsAsync(
                        new StationSettingsInput { Values = changed },
                        token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (saved is null)
            {
                return;
            }

            Notice = changed.Count == 1 ? "Saved one setting." : $"Saved {changed.Count} settings.";
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>A group's key as a heading: `llm` and `housekeeping` are not titles.</summary>
    private static string Title(string key) => key.Length switch
    {
        0 => key,
        _ => char.ToUpperInvariant(key[0]) + key[1..],
    };

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = http,
    });
}
