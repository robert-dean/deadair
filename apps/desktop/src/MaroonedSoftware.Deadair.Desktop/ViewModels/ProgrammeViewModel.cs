using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>Which of the programme's questions is showing.</summary>
public enum ProgrammeTab
{
    Today,
    Timetable,
}

/// <summary>
/// What the station is scheduled to do, what it says inside the hour, and what it is doing now.
/// </summary>
/// <remarks>
/// <para>
/// Tabs, as the web console has them, in the order the questions are asked: Today (what is on, and
/// the format clock) and the Timetable (the blocks across a week). Each tab is read when it is
/// opened, never on a timer.
/// </para>
/// </remarks>
public sealed partial class ProgrammeViewModel : ObservableObject
{
    private readonly HttpClient _http;
    private StationUrl _station;

    public ProgrammeViewModel(OperatorActions actions, HttpClient http, IDialogs dialogs)
    {
        _http = http;
        Today = new TodayViewModel(actions, Sdk, dialogs);
        Timetable = new TimetableViewModel(actions, Sdk, dialogs);

        // The strip's blocks open the timetable's own editor, and the strip is read again after a
        // save, since what is on may be what just changed.
        Today.EditSlotRequested += async slot =>
        {
            if (await Timetable.EditAsync(slot, Today.AiringSlotId, CancellationToken.None).ConfigureAwait(true))
            {
                await Today.LoadAsync(CancellationToken.None).ConfigureAwait(true);
            }
        };
    }

    public TodayViewModel Today { get; }

    public TimetableViewModel Timetable { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsToday), nameof(IsTimetable))]
    private ProgrammeTab _tab = ProgrammeTab.Today;

    public bool IsToday => Tab == ProgrammeTab.Today;

    public bool IsTimetable => Tab == ProgrammeTab.Timetable;

    [ObservableProperty]
    private bool _busy;

    public void Attach(StationUrl station) => _station = station;

    [RelayCommand]
    private async Task ShowTabAsync(string tab)
    {
        if (Enum.TryParse<ProgrammeTab>(tab, out var parsed) && parsed != Tab)
        {
            Tab = parsed;
            await LoadAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            switch (Tab)
            {
                case ProgrammeTab.Today:
                    await Today.LoadAsync(cancellationToken).ConfigureAwait(true);
                    break;
                case ProgrammeTab.Timetable:
                    await Timetable.LoadAsync(cancellationToken).ConfigureAwait(true);
                    break;
            }
        }
        finally
        {
            Busy = false;
        }
    }

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = _http,
    });
}
