using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;

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
public sealed partial class ShellViewModel : ObservableObject
{
    private readonly ISettingsStore _settings;
    private readonly SessionManager _session;

    public ShellViewModel(
        ISettingsStore settings,
        SessionManager session,
        SetupViewModel setup,
        ListenerViewModel listener,
        LoginViewModel login,
        TransportViewModel transport)
    {
        _settings = settings;
        _session = session;
        Setup = setup;
        Listener = listener;
        Login = login;
        Transport = transport;

        Setup.Connected += (station, name) => _ = AttachAsync(station, name);
        Login.SignedIn += () => ApplySession();
        _session.Changed += _ => ApplySession();
    }

    public SetupViewModel Setup { get; }

    public ListenerViewModel Listener { get; }

    public LoginViewModel Login { get; }

    public TransportViewModel Transport { get; }

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

        // The session comes first: the desk cannot read the transport without one, and the roles it
        // restores decide whether the desk is drawn at all.
        await _session.AttachAsync(station).ConfigureAwait(true);
        Transport.Attach(station);

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
    }

    [RelayCommand]
    private async Task SignOutAsync(CancellationToken cancellationToken)
    {
        // Signing out leaves somebody listening: the account buys the desk, and nothing else.
        await _session.SignOutAsync(cancellationToken).ConfigureAwait(true);
        ApplySession();
    }
}
