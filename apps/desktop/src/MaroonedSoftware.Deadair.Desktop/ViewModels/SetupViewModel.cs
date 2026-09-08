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
/// staring at an empty player. The four outcomes get four different sentences: "not a station",
/// "nothing answered" and "a station this build cannot read" are different problems with different
/// remedies, and collapsing them into "could not connect" leaves people guessing.
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

    /// <summary>Raised once a station has answered and been saved.</summary>
    public event Action<StationUrl, string?>? Connected;

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
                    await settings.SaveAsync(
                        settings.Current with { Station = station.ToString(), StationName = reading.Station },
                        cancellationToken).ConfigureAwait(true);
                    Connected?.Invoke(station, reading.Station);
                    break;

                case StationProbeResult.NotAStation:
                    Problem = "Something answered at that address, but it is not a deadair station.";
                    break;

                case StationProbeResult.Incompatible:
                    Problem = "That station speaks a version this app does not know. Update the app.";
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
