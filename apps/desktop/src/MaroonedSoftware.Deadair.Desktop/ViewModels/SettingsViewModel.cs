using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Desktop.Themes;
using MaroonedSoftware.Deadair.Sdk.Models;

// The destination types live in a namespace that shares its name with a property elsewhere.
using Nav = MaroonedSoftware.Deadair.Desktop.Navigation;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

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
/// The Settings page: a list of sections, this app's own card first and the station's after it.
/// </summary>
/// <remarks>
/// <para>
/// The web console's <c>SETTINGS_SECTIONS</c>, drawn as a list inside the page. The station's sections
/// appear only for an operator; this app's own card is reachable with no account at all, because
/// somebody who only listens should still be able to say whether they are looking at a light app or a
/// dark one.
/// </para>
/// <para>
/// Every section saves on its own. The write is partial, so a section cannot clear another, and an
/// edit left unsaved in one is kept while somebody looks at the next: the section view models are
/// built once and live as long as the page.
/// </para>
/// </remarks>
public sealed partial class SettingsViewModel : ObservableObject
{
    private readonly ISettingsStore settings;
    private readonly ThemeManager themes;
    private readonly IPluginCatalog? plugins;
    private readonly AppLog? log;
    private readonly DeclaredOptions? declared;
    private readonly SettingsCalls _calls;
    private readonly List<SettingsSectionViewModel> _stationSections = [];
    private bool _groupsLoaded;

    public SettingsViewModel(
        OperatorActions actions,
        HttpClient http,
        ISettingsStore settings,
        ThemeManager themes,
        IDialogs dialogs,
        SessionManager session,
        IUiDispatcher dispatcher,
        IFilePicker? files = null,
        IPluginCatalog? plugins = null,
        AppLog? log = null,
        DeclaredOptions? declared = null,
        ISystemShell? system = null,
        NavigationViewModel? navigation = null)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(dispatcher);

        this.settings = settings;
        this.themes = themes;
        this.plugins = plugins;
        this.log = log;
        this.declared = declared;
        _calls = new SettingsCalls(actions, http, dialogs, files, system);
        _navigation = navigation;

        Artwork = new ArtworkSectionViewModel(_calls);
        Storage = new StorageSectionViewModel(_calls);
        Providers = new ProvidersSectionViewModel(_calls);
        Grants = new GrantsSectionViewModel(_calls);
        Languages = new LanguagesSectionViewModel(_calls);
        StationPlugins = new PluginsSectionViewModel(_calls, plugin => _navigation?.Push(new Nav.Destination.PluginDetail(plugin.Id, plugin.Name)));

        SettingsSectionViewModel? app = null;
        foreach (var section in SettingsSections.All)
        {
            object content = section switch
            {
                { Id: SettingsSectionId.App } => this,
                { Id: SettingsSectionId.Artwork } => Artwork,
                { Id: SettingsSectionId.Storage } => Storage,
                { Id: SettingsSectionId.Providers } => Providers,
                { Id: SettingsSectionId.Grants } => Grants,
                { Id: SettingsSectionId.Plugins } => StationPlugins,
                { Id: SettingsSectionId.Languages } => Languages,
                { Id: SettingsSectionId.Security } => Security = new SecuritySectionViewModel(AddGroup(section), _calls, session),
                { Group: not null } => AddGroup(section),
                _ => throw new InvalidOperationException($"No contents for the {section.Label} section."),
            };

            var entry = new SettingsSectionViewModel(section, content);
            if (section.NeedsOperator)
            {
                _stationSections.Add(entry);
            }
            else
            {
                app = entry;
            }
        }

        AppSection = app ?? throw new InvalidOperationException("The section list has no card for this app.");
        _current = AppSection;
        _current.IsActive = true;
        Sections.Add(AppSection);

        // Every page's calls, not only this one's: a change the station will not make without a fresh
        // second factor asks for one and is tried again, wherever it was pressed.
        StepUpDialogViewModel.Install(actions, session, _calls, dispatcher);

        session.Changed += state => dispatcher.Post(() => ApplyRole(state is SessionState.SignedIn { IsOperator: true }));
        _session = session;
    }

    private readonly SessionManager _session;
    private readonly NavigationViewModel? _navigation;

    /// <summary>This install's own card, always in the list.</summary>
    public SettingsSectionViewModel AppSection { get; }

    /// <summary>The station's sections, listed only while the account is the operator's.</summary>
    public ObservableCollection<SettingsSectionViewModel> StationSections { get; } = [];

    /// <summary>Every section this account can open, in order, for the box that stands in for the list on a narrow page.</summary>
    public ObservableCollection<SettingsSectionViewModel> Sections { get; } = [];

    /// <summary>The section being shown.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Picked))]
    private SettingsSectionViewModel _current;

    /// <summary>
    /// The box's choice. A separate property from <see cref="Current"/> because the box answers null
    /// while its list is being refilled, and a page must always be showing something.
    /// </summary>
    public SettingsSectionViewModel? Picked
    {
        get => Current;
        set
        {
            if (value is not null && !ReferenceEquals(value, Current))
            {
                ShowSection(value);
            }
        }
    }

    /// <summary>Whether the station's sections are listed.</summary>
    [ObservableProperty]
    private bool _isOperator;

    public IReadOnlyList<SettingsGroupViewModel> Groups => _groups;

    private readonly List<SettingsGroupViewModel> _groups = [];

    public ArtworkSectionViewModel Artwork { get; }

    public StorageSectionViewModel Storage { get; }

    public ProvidersSectionViewModel Providers { get; }

    public GrantsSectionViewModel Grants { get; }

    /// <summary>The web console's language packs, which this app does not use itself.</summary>
    public LanguagesSectionViewModel Languages { get; }

    /// <summary>What every section reaches the station with, for a dialog built outside the page.</summary>
    public SettingsCalls Calls => _calls;

    /// <summary>Sign-in and security: this account's own half, and the station's.</summary>
    public SecuritySectionViewModel? Security { get; private set; }

    /// <summary>
    /// The STATION's plugins, which run in the station. This app's own (somewhere else to play the
    /// station) are <see cref="Plugins"/>, drawn as Extensions on this app's card, and the two are
    /// never listed together.
    /// </summary>
    public PluginsSectionViewModel StationPlugins { get; }

    /// <summary>Builds and reads one station plugin's page, for a detail destination.</summary>
    public StationPluginViewModel OpenPlugin(string id, string name)
    {
        var page = new StationPluginViewModel(id, name, _calls, declared, () => _navigation?.Back());
        page.LoadCommand.Execute(null);
        return page;
    }

    private SettingsGroupViewModel AddGroup(SettingsSection section)
    {
        var group = new SettingsGroupViewModel(section, _calls, (saver, answer) =>
        {
            // A save answers with everything the station holds. The other groups take it unless one
            // of them holds an edit, which the fresh values would overwrite.
            foreach (var other in _groups.Where(other => !ReferenceEquals(other, saver)))
            {
                other.Present(answer, force: false);
            }
        });

        _groups.Add(group);
        return group;
    }

    /// <summary>Lists the station's sections for an operator and takes them away from anybody else.</summary>
    /// <remarks>
    /// Public so a headless render can pose the role without a session. Somebody who stops being the
    /// operator while looking at a station section is sent back to this app's card, rather than left
    /// on a page whose every call would now be refused.
    /// </remarks>
    public void ApplyRole(bool isOperator)
    {
        IsOperator = isOperator;
        StationSections.Clear();
        Sections.Clear();
        Sections.Add(AppSection);

        if (isOperator)
        {
            foreach (var section in _stationSections)
            {
                StationSections.Add(section);
                Sections.Add(section);
            }
        }
        else
        {
            if (Current.Section.NeedsOperator)
            {
                ShowSection(AppSection);
            }

            // A station plugin's page is under Settings, which anybody may open, so the rail would
            // leave somebody who has just signed out looking at it.
            if (_navigation?.Current is Nav.Destination.PluginDetail)
            {
                _navigation.Show(new Nav.Destination.Settings());
            }
        }
    }

    [RelayCommand]
    private void ShowSection(SettingsSectionViewModel section)
    {
        ArgumentNullException.ThrowIfNull(section);

        Current.IsActive = false;
        Current = section;
        section.IsActive = true;

        if (IsOperator && section.Content is ISettingsSectionContent content)
        {
            content.Shown();
        }
    }

    /// <summary>
    /// The page was opened: read the station's settings the first time, and freshen the section on screen.
    /// </summary>
    /// <remarks>
    /// The settings are read once and kept rather than on every visit, because a re-read rebuilds the
    /// forms and would throw away whatever somebody typed and has not yet saved. Nothing is read for
    /// somebody who is not the operator: every one of these calls would be refused.
    /// </remarks>
    public void Open()
    {
        if (!IsOperator)
        {
            return;
        }

        if (!_groupsLoaded)
        {
            LoadCommand.Execute(null);
        }

        if (Current.Content is ISettingsSectionContent content)
        {
            content.Shown();
        }
    }

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
    /// The page reads the station's settings only once, and the formats come from the listener's
    /// readings, so both would go on describing the old station without this. An edit left unsaved
    /// for the old station goes with it: it was never going to be the new one's.
    /// </remarks>
    public void Reset()
    {
        _groupsLoaded = false;
        foreach (var group in _groups)
        {
            group.Reset();
        }

        Artwork.Reset();
        Storage.Reset();
        Providers.Reset();
        Grants.Reset();
        StationPlugins.Reset();
        Security?.Reset();
        Languages.Reset();
        ApplyMounts([]);
    }

    public void Attach(StationUrl station)
    {
        _station = station;
        _calls.Station = station;
        ApplyRole(_session.State is SessionState.SignedIn { IsOperator: true });
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

    /// <summary>Reads every setting the station declares and hands each group its own.</summary>
    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;

        try
        {
            var station = await _calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = _calls.Sdk();
                    return await sdk.Settings.GetSettingsAsync(token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (station is null)
            {
                return;
            }

            Present(station);

            // One read per source across every group, rather than one per group that names it.
            var sources = _groups.Where(group => group.Form is not null).SelectMany(group => group.Form!.Sources()).ToHashSet();
            if (declared is not null && sources.Count > 0)
            {
                var resolved = await declared.ResolveAsync(_station, sources, cancellationToken).ConfigureAwait(true);
                foreach (var group in _groups)
                {
                    group.Offer(resolved);
                }
            }
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Draws what the station declared and holds, each group as its own form.</summary>
    public void Present(StationSettings station)
    {
        ArgumentNullException.ThrowIfNull(station);

        foreach (var group in _groups)
        {
            group.Present(station, force: true);
        }

        _groupsLoaded = true;
    }
}
