using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Services;
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
    IPluginCatalog? plugins = null,
    AppLog? log = null) : ObservableObject
{
    private StationUrl _station;

    /// <summary>Whether there is a log file to show, which there is not in a headless render.</summary>
    public bool CanRevealLog => log?.CanReveal == true;

    /// <summary>Where the log is, said on the page so it can be found without the button too.</summary>
    public string LogNote => log?.FilePath is { } path
        ? $"What this app did and what went wrong, kept on this Mac and never sent anywhere: {path}"
        : "This copy of the app is not keeping a log.";

    /// <remarks>
    /// On this page rather than the check-up, because the check-up needs an operator and a listener
    /// with a problem has no account.
    /// </remarks>
    [RelayCommand]
    private void RevealLog() => log?.Reveal();

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

    /// <summary>Whether the app asks GitHub for a newer release when it starts. Saved at once, like the others.</summary>
    [ObservableProperty]
    private bool _checkForUpdates = true;

    /// <summary>This build, beside the card's heading, so a notice about a newer one has something to compare with.</summary>
    public static string Version { get; } = $"VERSION {AppVersion.Current}";

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _notice;

    private const string SleepOff =
        "Stops listening after a while, which also tells the station you have gone. Nothing is set.";

    private bool _applyingSleep;

    /// <summary>The sleep timer's choice in minutes, nought for off.</summary>
    /// <remarks>
    /// Chosen here and kept by the listener, which owns the only stop. Nothing about it is saved:
    /// a timer set last night must not stop tonight's listening.
    /// </remarks>
    [ObservableProperty]
    private int _sleepMinutes;

    /// <summary>When it will stop, or what it is for while nothing is set.</summary>
    [ObservableProperty]
    private string _sleepNote = SleepOff;

    /// <summary>Raised with the time chosen, or null for off.</summary>
    public event Action<TimeSpan?>? SleepRequested;

    /// <summary>Told when the timer changed, including when it elapsed or a Stop cancelled it.</summary>
    /// <remarks>
    /// Setting <see cref="SleepMinutes"/> back to nought here would otherwise ask the listener to
    /// cancel a timer that has already gone, so it is done under a guard that keeps it quiet.
    /// </remarks>
    public void ApplySleep(DateTimeOffset? endsAt)
    {
        SleepNote = endsAt is { } at
            ? $"Stops at {ClockFormat.WallClock(at.ToLocalTime())}."
            : SleepOff;

        if (endsAt is null && SleepMinutes != 0)
        {
            _applyingSleep = true;
            try
            {
                SleepMinutes = 0;
            }
            finally
            {
                _applyingSleep = false;
            }
        }
    }

    partial void OnSleepMinutesChanged(int value)
    {
        if (!_applyingSleep)
        {
            SleepRequested?.Invoke(value > 0 ? TimeSpan.FromMinutes(value) : null);
        }
    }

    /// <summary>Said when this install's settings file could not be read and is being left alone.</summary>
    /// <remarks>
    /// Without it, the failure is invisible in the worst way: every change on this page appears to
    /// work, and is gone at the next launch. The path is in the sentence because the remedy is to
    /// open that file.
    /// </remarks>
    [ObservableProperty]
    private string? _settingsProblem;

    /// <summary>The one sentence for a settings file nobody can read, shared with the setup screen.</summary>
    internal static string? DescribeProblem(SettingsFileProblem? problem) => problem is null
        ? null
        : $"Your settings file could not be read, so nothing you change is being saved. Fix or remove it and "
            + $"start the app again: {problem.Path}";

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

    /// <summary>The station this app is pointed at, as its name.</summary>
    [ObservableProperty]
    private string _stationName = string.Empty;

    /// <summary>And as its address, which is what somebody changing it needs to see.</summary>
    [ObservableProperty]
    private string _stationAddress = string.Empty;

    /// <summary>Forgets the old station's settings, so the next visit fetches the new one's.</summary>
    /// <remarks>
    /// The page fetches only while it has no groups, and the formats come from the listener's
    /// readings, so both would go on describing the old station without this.
    /// </remarks>
    public void Reset()
    {
        Groups.Clear();
        ApplyMounts([]);
        Notice = null;
    }

    public void Attach(StationUrl station)
    {
        _station = station;
        StationAddress = station.ToString();
        StationName = settings.Current.StationName ?? station.Origin.Host;
        Appearance = settings.Current.Appearance;
        NextSkips = settings.Current.NextSkips;
        CheckForUpdates = settings.Current.CheckForUpdates;
        MarkChosenFormat(settings.Current.Format);
        SettingsProblem = DescribeProblem(settings.Problem);
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

    partial void OnCheckForUpdatesChanged(bool value) => _ = settings.UpdateAsync(current => current with { CheckForUpdates = value });

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
