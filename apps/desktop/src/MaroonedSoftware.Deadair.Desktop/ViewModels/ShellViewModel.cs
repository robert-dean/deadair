using CommunityToolkit.Mvvm.ComponentModel;
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

    public ShellViewModel(ISettingsStore settings, SetupViewModel setup, ListenerViewModel listener)
    {
        _settings = settings;
        Setup = setup;
        Listener = listener;

        Setup.Connected += (station, name) =>
        {
            Listener.Attach(station, name);
            NeedsStation = false;
        };
    }

    public SetupViewModel Setup { get; }

    public ListenerViewModel Listener { get; }

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
            Listener.Attach(station, _settings.Current.StationName);
            NeedsStation = false;
        }
        else
        {
            Setup.Address = string.Empty;
            NeedsStation = true;
        }

        Ready = true;
    }
}
