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
    [NotifyCanExecuteChangedFor(nameof(ConnectCommand))]
    private string _address = string.Empty;

    [ObservableProperty]
    private bool _busy;

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
    private bool _canCancel;

    /// <summary>Raised when somebody decides to stay on the station they had.</summary>
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

    /// <summary>Raised once a station has answered and been saved.</summary>
    public event Action<StationUrl, string?>? Connected;

    /// <summary>Re-reads <see cref="SettingsProblem"/>, which only a load can change.</summary>
    public void RefreshSettingsProblem() => OnPropertyChanged(nameof(SettingsProblem));

    private bool CanConnect => !string.IsNullOrWhiteSpace(Address) && !Busy;

    [RelayCommand(CanExecute = nameof(CanConnect))]
    private async Task ConnectAsync(CancellationToken cancellationToken)
    {
        Problem = null;

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
                    await settings.UpdateAsync(
                        current => current with { Station = station.ToString(), StationName = reading.Station },
                        cancellationToken).ConfigureAwait(true);
                    Connected?.Invoke(station, reading.Station);
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
}
