using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Plugins;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Themes;

// The `Navigation` property below shadows the namespace of the same name, so the destination types
// need an alias to be reachable from inside this class.
using Nav = MaroonedSoftware.Deadair.Desktop.Navigation;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// The window, and which of the two things it can be showing.
/// </summary>
/// <remarks>
/// Setup is chosen ABOVE the stack rather than pushed onto it, which is the arrangement the Android
/// app arrived at: an app with no station is not an app on its first page, it is an app that cannot
/// do anything yet, and letting somebody navigate away from that is letting them reach screens with
/// nothing behind them.
/// </remarks>
public sealed partial class ShellViewModel : ObservableObject, IDisposable
{
    private readonly ISettingsStore _settings;
    private readonly SessionManager _session;
    private readonly ThemeManager _themes;
    private readonly IUiDispatcher _dispatcher;

    /// <summary>
    /// Kept so it can be unsubscribed: <see cref="NextSkips"/> lives in the settings file, so turning
    /// it on or off has to reapply the system's Next button the same way signing in and out already
    /// does.
    /// </summary>
    private readonly Action<DesktopSettings> _onSettingsChanged;

    /// <summary>
    /// Optional so that a shot can build a shell without one. Nothing about a rendered page needs
    /// plugins, and a shot that started them would go looking for speakers on somebody's network.
    /// </summary>
    private readonly PluginManager? _plugins;

    public ShellViewModel(
        ISettingsStore settings,
        SessionManager session,
        SetupViewModel setup,
        ListenerViewModel listener,
        LoginViewModel login,
        TransportViewModel transport,
        RunningOrderViewModel order,
        NavigationViewModel navigation,
        ProgrammeViewModel programme,
        LibraryViewModel library,
        HistoryViewModel history,
        CheckupViewModel checkup,
        SettingsViewModel stationSettings,
        VoiceViewModel voice,
        ThemeManager themes,
        IUiDispatcher dispatcher,
        PluginManager? plugins = null)
    {
        _settings = settings;
        _session = session;
        _dispatcher = dispatcher;
        Setup = setup;
        Listener = listener;
        Login = login;
        Transport = transport;
        Order = order;
        Navigation = navigation;
        Programme = programme;
        Library = library;
        History = history;
        Checkup = checkup;
        StationSettings = stationSettings;
        Voice = voice;
        _themes = themes;
        _plugins = plugins;

        Setup.Connected += (station, name) => _ = AttachAsync(station, name);
        Login.SignedIn += () => ApplySession();
        _session.Changed += _ => _dispatcher.Post(ApplySession);

        // NextSkips lives in the settings file rather than on the session, so turning it on or off
        // has to reapply the system's Next button the same way signing in and out already does.
        // FileSettingsStore raises Changed after a ConfigureAwait(false), on a pool thread, and
        // ApplySession sets UI-bound properties.
        _onSettingsChanged = _ => _dispatcher.Post(ApplySession);
        _settings.Changed += _onSettingsChanged;

        // A media key's Next is the operator's Skip, so it goes through the desk rather than the
        // player: the player has no next track to move to.
        Listener.SkipRequested += Transport.SkipFromSystemAsync;

        // The format picker is told what the station publishes rather than asking, and never by
        // connecting to a mount to find out.
        Listener.MountsChanged += StationSettings.ApplyMounts;

        // A page fetches when it is opened rather than on a timer. A catalog does not change while
        // somebody is looking at it, and the station rate-limits.
        Navigation.Navigated += destination =>
        {
            switch (destination)
            {
                case Nav.Destination.Programme:
                    Programme.LoadCommand.Execute(null);
                    break;
                case Nav.Destination.Library when Library.Tracks.Count == 0:
                    Library.LoadCommand.Execute(null);
                    break;
                case Nav.Destination.History:
                    History.LoadCommand.Execute(null);
                    break;
                case Nav.Destination.Checkup:
                    Checkup.LoadCommand.Execute(null);
                    break;
                case Nav.Destination.Settings when StationSettings.Groups.Count == 0:
                    StationSettings.LoadCommand.Execute(null);
                    break;
                case Nav.Destination.Voice:
                    Voice.LoadCommand.Execute(null);
                    break;
            }
        };
    }

    public SetupViewModel Setup { get; }

    public ListenerViewModel Listener { get; }

    public LoginViewModel Login { get; }

    public TransportViewModel Transport { get; }

    public RunningOrderViewModel Order { get; }

    public NavigationViewModel Navigation { get; }

    public ProgrammeViewModel Programme { get; }

    public LibraryViewModel Library { get; }

    public HistoryViewModel History { get; }

    public CheckupViewModel Checkup { get; }

    public SettingsViewModel StationSettings { get; }

    public VoiceViewModel Voice { get; }

    /// <summary>Whether to draw the sign-in panel rather than the account it produced.</summary>
    [ObservableProperty]
    private bool _signedOut = true;

    [ObservableProperty]
    private string? _account;

    [ObservableProperty]
    private bool _needsStation = true;

    [ObservableProperty]
    private bool _ready;

    public async Task StartAsync()
    {
        await _settings.LoadAsync().ConfigureAwait(true);

        // After the settings and before anything asks a plugin for anything: which plugins run is a
        // decision kept in that file, so starting them first would start the wrong ones.
        if (_plugins is not null)
        {
            await _plugins.StartAsync().ConfigureAwait(true);
        }

        StationSettings.AttachPlugins();

        // Before anything is drawn, so the window does not open in the wrong appearance and then
        // repaint. Applying System is applying nothing, which is what makes the system's own choice
        // land on the first frame.
        _themes.Apply(_settings.Current.Appearance);

        if (StationUrl.TryParse(_settings.Current.Station, out var station))
        {
            // Not probed on the way in. The address answered once, the app has nothing better to
            // offer than what it already knows, and a station that is merely asleep should not send
            // somebody back to a setup screen they have already filled in.
            await AttachAsync(station, _settings.Current.StationName).ConfigureAwait(true);
        }
        else
        {
            Setup.Address = string.Empty;
            NeedsStation = true;
        }

        Ready = true;
    }

    private async Task AttachAsync(StationUrl station, string? name)
    {
        Listener.Attach(station, name);

        if (Listener.Outputs is { } outputs)
        {
            outputs.Attach(station);

            // Back to wherever the station was last playing, before anybody presses anything. It is
            // a scan and a selection, both of which are quiet while nothing is playing.
            await outputs.RestoreAsync().ConfigureAwait(true);
        }

        // The session comes first: the desk cannot read the transport without one, and the roles it
        // restores decide whether the desk is drawn at all.
        await _session.AttachAsync(station).ConfigureAwait(true);
        Transport.Attach(station);
        Order.Attach(station);
        Programme.Attach(station);
        Library.Attach(station);
        History.Attach(station);
        Checkup.Attach(station);
        StationSettings.Attach(station);
        Voice.Attach(station);

        NeedsStation = false;
        ApplySession();

        // Once per run, and only for a session that came back from the store: a cached role can be
        // out of date and the station is the one that knows.
        await _session.EnsureRolesAsync().ConfigureAwait(true);
    }

    private void ApplySession()
    {
        SignedOut = _session.State is SessionState.SignedOut;
        Account = _session.State is SessionState.SignedIn signedIn ? signedIn.Email : null;

        // The system's next button is a statement about the ACCOUNT rather than about the player: a
        // listener has no skip to make, and offering one would promise something the station refuses.
        // It is also off by default even for the operator: a system Next key skips the record for
        // every listener, with no second press to reconsider, so it stays off until NextSkips says
        // the operator has turned it on.
        var isOperator = _session.State is SessionState.SignedIn { IsOperator: true };
        Listener.SetCanSkip(isOperator && _settings.Current.NextSkips);

        // The rail hides what this account cannot reach, and sends somebody back to the desk rather
        // than leaving them on a page that has just become empty.
        Navigation.ApplyRole(isOperator);
    }

    /// <summary>Back to what is on air, from the player bar on any other page.</summary>
    [RelayCommand]
    private void ShowDesk() => Navigation.Show(new Nav.Destination.Desk());

    [RelayCommand]
    private async Task SignOutAsync(CancellationToken cancellationToken)
    {
        // Signing out leaves somebody listening: the account buys the desk, and nothing else.
        await _session.SignOutAsync(cancellationToken).ConfigureAwait(true);
        ApplySession();
    }

    public void Dispose() => _settings.Changed -= _onSettingsChanged;
}
