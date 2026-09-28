using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// Pointing the app at a station.
/// </summary>
/// <remarks>
/// The address is probed before it is saved, so somebody who mistypes finds out here rather than by
/// staring at an empty player. The outcomes get different sentences: "not a station", "nothing
/// answered", "a station this build cannot read" and "a certificate this Mac does not trust" are
/// different problems with different remedies, and collapsing them into "could not connect" leaves
/// people guessing.
/// </remarks>
public sealed partial class SetupViewModel(ISettingsStore settings, StationProbe probe) : ObservableObject
{
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CheckCommand))]
    private string _address = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CheckCommand))]
    private bool _busy;

    /// <summary>
    /// The station the address answered as, once it has. Until then the button says Check; after, it
    /// names the station, which is the Android app's order and the reason for it: somebody sees WHICH
    /// station they found before anything is kept or anything plays.
    /// </summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Confirmed))]
    [NotifyPropertyChangedFor(nameof(ListenLabel))]
    private string? _confirmedName;

    /// <summary>The address that answered, kept beside its name so Listen saves exactly what was checked.</summary>
    private StationUrl? _confirmed;

    /// <summary>The name exactly as the station gave it, which may be none; the settings keep that, not the fallback.</summary>
    private string? _confirmedReading;

    /// <summary>For the view, which swaps Check for Listen once the address has answered.</summary>
    public bool Confirmed => ConfirmedName is not null;

    /// <summary>What the Listen button says.</summary>
    public string ListenLabel => $"Listen to {ConfirmedName}";

    /// <summary>Typing again clears the verdict: what was checked is no longer what is in the box.</summary>
    partial void OnAddressChanged(string value) => Forget();

    private void Forget()
    {
        _confirmed = null;
        _confirmedReading = null;
        ConfirmedName = null;
    }

    [ObservableProperty]
    private string? _problem;

    /// <summary>
    /// Something to know that is not a problem: which station the app is on now, when it is being
    /// asked to move to another.
    /// </summary>
    [ObservableProperty]
    private string? _note;

    /// <summary>Whether there is a station to go back to, and so a way off this screen without connecting.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanGoBack))]
    [NotifyCanExecuteChangedFor(nameof(BackCommand))]
    private bool _canCancel;

    /// <summary>Which half is showing. The welcome until somebody asks to find a station, or is asked for one.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Welcoming))]
    [NotifyPropertyChangedFor(nameof(Finding))]
    [NotifyPropertyChangedFor(nameof(SigningIn))]
    [NotifyPropertyChangedFor(nameof(CanGoBack))]
    [NotifyCanExecuteChangedFor(nameof(BackCommand))]
    private SetupStep _step = SetupSteps.Initial(asking: false);

    /// <summary>For the view, which shows one part at a time.</summary>
    public bool Welcoming => Step == SetupStep.Welcome;

    /// <inheritdoc cref="Welcoming"/>
    public bool Finding => Step == SetupStep.Station;

    /// <inheritdoc cref="Welcoming"/>
    public bool SigningIn => Step == SetupStep.SignIn;

    /// <summary>
    /// The station kept for signing in to is still being attached. The form waits for it: the session
    /// it signs in through is attached along with everything else, and a sign-in sent before that has
    /// no station to go to.
    /// </summary>
    [ObservableProperty]
    private bool _attaching;

    /// <summary>The station being signed in to, for the heading.</summary>
    [ObservableProperty]
    private string? _signingInTo;

    /// <summary>
    /// What the way out of signing in says. From the wizard it says what declining leaves, because the
    /// station was only just kept and nothing is playing yet; from the sidebar, somebody is already
    /// listening and "Not now" is the whole of it.
    /// </summary>
    [ObservableProperty]
    private string _declineLabel = "Not now, just listen";

    /// <summary>
    /// Opens the screen straight on signing in, for the sidebar's Sign in: the one sign-in form, drawn
    /// the same way whether it is reached from the wizard or from an app already listening. The
    /// station is attached, so there is nothing to wait for and nothing to go back to but the app.
    /// </summary>
    public void OpenSignIn(string station)
    {
        Forget();
        Problem = null;
        SigningInTo = station;
        DeclineLabel = "Not now";
        Attaching = false;
        Step = SetupStep.SignIn;

        // Said even when it was already the step: leaving by Not now does not move the step, so a
        // second Sign in would change nothing, and the view readies the form on this notice.
        OnPropertyChanged(nameof(Step));
    }

    /// <summary>Opens the screen on the half that fits why it is showing. See <see cref="SetupSteps.Initial"/>.</summary>
    /// <remarks>
    /// The verdict is forgotten here as well as on typing: an address set to what it already was
    /// raises no change, and an old "Listen to" would then sit under an address nobody has checked.
    /// </remarks>
    public void Open(bool asking)
    {
        Forget();
        Step = SetupSteps.Initial(asking);
    }

    [RelayCommand]
    private void Start() => Step = SetupStep.Station;

    /// <summary>
    /// Back a step. From the address, to the welcome, but only on a first run: with a station to go
    /// back to, "back" means keep it, and that is <see cref="CancelCommand"/>, since a welcome in front
    /// of an app somebody is already listening through would be a door into a room they are standing
    /// in. From signing in, off the screen altogether: the station is already kept, so declining to
    /// sign in leaves somebody listening, which is where Listen would have left them. The Android app
    /// lands on Now playing from the same place for the same reason.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanGoBack))]
    private void Back()
    {
        Problem = null;

        if (Step == SetupStep.SignIn)
        {
            Cancelled?.Invoke();
            return;
        }

        Step = SetupStep.Welcome;
    }

    /// <summary>Whether <see cref="BackCommand"/> has anywhere to go, which is also whether its button shows.</summary>
    public bool CanGoBack => Step == SetupStep.SignIn || (Step == SetupStep.Station && !CanCancel);

    /// <summary>Raised when somebody decides to stay on the station they had.</summary>
    /// <remarks>Also raised by Not now on the sign-in step, which leaves the setup screen the same way.</remarks>
    public event Action? Cancelled;

    [RelayCommand]
    private void Cancel()
    {
        Problem = null;
        Note = null;
        Cancelled?.Invoke();
    }

    /// <summary>Said when the settings file could not be read, which is often WHY this screen is showing.</summary>
    /// <remarks>
    /// An unreadable file loses the station address along with everything else, so the first thing
    /// somebody sees is this screen asking for an address they already gave. Without the sentence they
    /// retype it, it connects, and it is gone again at the next launch because the file is not written.
    /// </remarks>
    public string? SettingsProblem => SettingsViewModel.DescribeProblem(settings.Problem);

    /// <summary>
    /// Raised once a station has answered and been saved: the address, the name it gave, and whether
    /// somebody asked to sign in to it as well.
    /// </summary>
    public event Action<StationUrl, string?, bool>? Connected;

    /// <summary>Re-reads <see cref="SettingsProblem"/>, which only a load can change.</summary>
    public void RefreshSettingsProblem() => OnPropertyChanged(nameof(SettingsProblem));

    private bool CanCheck => !string.IsNullOrWhiteSpace(Address) && !Busy;

    /// <summary>
    /// Asks the address whether it is a station, and keeps nothing. Listen does the keeping.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanCheck))]
    private async Task CheckAsync(CancellationToken cancellationToken)
    {
        Problem = null;
        Forget();

        if (!StationUrl.TryParse(Address, out var station))
        {
            Problem = "That does not look like an address. Try something like radio.example.com.";
            return;
        }

        Busy = true;
        try
        {
            var reading = await probe.ProbeAsync(station, cancellationToken).ConfigureAwait(true);

            switch (reading.Result)
            {
                case StationProbeResult.Reachable:
                    _confirmed = station;
                    ConfirmedName = ConfirmedNameFor(station, reading.Station);
                    _confirmedReading = reading.Station;
                    break;

                case StationProbeResult.NotAStation:
                    Problem = "Something answered at that address, but it is not a deadair station.";
                    break;

                case StationProbeResult.Incompatible:
                    Problem = "That station speaks a version this app does not know. Update the app.";
                    break;

                case StationProbeResult.Untrusted:
                    Problem = "This Mac does not trust that station's certificate. Add the certificate "
                        + "authority to the system keychain and mark it trusted there, then try again.";
                    break;

                default:
                    Problem = "Nothing answered at that address. Check the station is running.";
                    break;
            }
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Keeps the station that answered and hands it to the shell to attach.</summary>
    [RelayCommand]
    private Task ListenAsync(CancellationToken cancellationToken) => KeepAsync(signIn: false, cancellationToken);

    /// <summary>
    /// Keeps the station and goes straight on to signing in to it. Offered once the address has
    /// answered and not before, because an account belongs to a station and there is not one yet.
    /// Second, and quieter, because most people who get this far only want to listen.
    /// </summary>
    [RelayCommand]
    private Task ListenAndSignInAsync(CancellationToken cancellationToken) => KeepAsync(signIn: true, cancellationToken);

    private async Task KeepAsync(bool signIn, CancellationToken cancellationToken)
    {
        if (_confirmed is not { } station)
        {
            return;
        }

        var name = _confirmedReading;
        await settings.UpdateAsync(current => current with { Station = station.ToString(), StationName = name }, cancellationToken)
            .ConfigureAwait(true);
        Forget();

        if (signIn)
        {
            SigningInTo = ConfirmedNameFor(station, name);
            DeclineLabel = "Not now, just listen";
            Attaching = true;
            Step = SetupStep.SignIn;
        }

        Connected?.Invoke(station, name, signIn);
    }

    /// <summary>A station too old to say its name is still a station; it is named by its address rather than going blank.</summary>
    private static string ConfirmedNameFor(StationUrl station, string? name) =>
        string.IsNullOrWhiteSpace(name) ? station.Origin.Host : name;
}
