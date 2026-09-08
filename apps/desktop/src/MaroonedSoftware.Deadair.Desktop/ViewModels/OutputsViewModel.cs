using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One row of the output picker.</summary>
public sealed partial class OutputChoiceViewModel(Output output) : ObservableObject
{
    public Output Output { get; } = output;

    public string Name { get; } = output.Name;

    /// <summary>A second line: the hardware, or what it is.</summary>
    public string Detail { get; } = output.IsLocal ? "Built in" : output.Model ?? output.Address;

    [ObservableProperty]
    private bool _isActive;

    /// <summary>
    /// Whether it was in the last scan.
    /// </summary>
    /// <remarks>
    /// Drawn and disabled rather than removed while it is the active one, which is the Android
    /// listener's rule about formats arriving from the other direction: a row somebody cannot choose
    /// tells them the speaker is not answering, and a row that vanished tells them nothing.
    /// </remarks>
    [ObservableProperty]
    private bool _isMissing;
}

/// <summary>
/// Where the station comes out, and the picker that changes it.
/// </summary>
/// <remarks>
/// Discovery runs when the picker is opened and when somebody asks it to look again, never on a
/// timer: a scan is a broadcast and a request to every device the operator wrote down, and nobody is
/// looking between opens.
/// </remarks>
public sealed partial class OutputsViewModel(OutputCatalog catalog, IUiDispatcher dispatcher) : ObservableObject
{
    private StationUrl _station;

    public ObservableCollection<OutputChoiceViewModel> Choices { get; } = [];

    [ObservableProperty]
    private bool _scanning;

    /// <summary>What went wrong, or what is worth knowing. Under the list, in a quiet colour.</summary>
    [ObservableProperty]
    private string? _notice;

    public string RescanLabel => Scanning ? "Looking…" : "Look again";

    /// <summary>Raised when the picker has done something the bar should show.</summary>
    public event Action? Changed;

    public void Attach(StationUrl station)
    {
        _station = station;
        catalog.Changed += () => dispatcher.Post(Refresh);
        Refresh();
    }

    /// <summary>Goes back to wherever the station was last playing, at launch.</summary>
    public async Task RestoreAsync()
    {
        var restored = await catalog.RestoreAsync(_station).ConfigureAwait(true);

        if (restored == OutputRestore.NotFound && catalog.Remembered is { } name)
        {
            // Said rather than silently corrected. Somebody who left the station playing in the
            // kitchen and finds it on their laptop should be told which of the two happened.
            Notice = $"{name} is not on the network. Playing here instead.";
        }

        Refresh();
    }

    [RelayCommand]
    public async Task RescanAsync()
    {
        await catalog.RescanAsync().ConfigureAwait(true);

        if (Choices.Count == 1)
        {
            Notice = "No players found on this network.";
        }
        else if (Notice is not null && Notice.StartsWith("No players", StringComparison.Ordinal))
        {
            Notice = null;
        }
    }

    [RelayCommand]
    private async Task ChooseAsync(OutputChoiceViewModel? choice)
    {
        if (choice is null || choice.IsActive)
        {
            return;
        }

        Notice = await catalog.SelectAsync(choice.Output, _station).ConfigureAwait(true) switch
        {
            OutputSelection.StationUnreachable => OutputReach.Explain(_station, choice.Output),
            OutputSelection.NotFound => $"{choice.Name} is not there any more.",
            _ => null,
        };

        Refresh();
        Changed?.Invoke();
    }

    private void Refresh()
    {
        Scanning = catalog.Scanning;
        OnPropertyChanged(nameof(RescanLabel));

        var outputs = catalog.Outputs;
        var active = catalog.Active;

        // The active output is always a row, even when the last scan did not find it: taking it away
        // would leave the picker with nothing checked while the sound was plainly coming out of it.
        var rows = outputs.Any(output => output.Key == active.Key) ? outputs : [.. outputs, active];

        Choices.Clear();

        foreach (var output in rows)
        {
            Choices.Add(new OutputChoiceViewModel(output)
            {
                IsActive = output.Key == active.Key,
                IsMissing = output.Key == active.Key && catalog.ActiveMissing,
            });
        }
    }
}
