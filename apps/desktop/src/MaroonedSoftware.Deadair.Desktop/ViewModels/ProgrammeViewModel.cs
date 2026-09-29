using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One slot in the week.</summary>
public sealed record SlotViewModel(string Id, string Days, string Window, string Label, string? Brief, bool IsAiring);

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
/// <para>
/// A slot's times are MINUTES FROM MIDNIGHT rather than clock strings, and its days are a list of
/// weekday numbers rather than one day, because a slot recurs.
/// </para>
/// </remarks>
public sealed partial class ProgrammeViewModel : ObservableObject
{
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private StationUrl _station;

    public ProgrammeViewModel(OperatorActions actions, HttpClient http, IDialogs dialogs)
    {
        _actions = actions;
        _http = http;
        Today = new TodayViewModel(actions, Sdk, dialogs);
    }

    public TodayViewModel Today { get; }

    public ObservableCollection<SlotViewModel> Slots { get; } = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsToday), nameof(IsTimetable))]
    private ProgrammeTab _tab = ProgrammeTab.Today;

    public bool IsToday => Tab == ProgrammeTab.Today;

    public bool IsTimetable => Tab == ProgrammeTab.Timetable;

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _problem;

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
                    await LoadTimetableAsync(cancellationToken).ConfigureAwait(true);
                    break;
            }
        }
        finally
        {
            Busy = false;
        }
    }

    private async Task LoadTimetableAsync(CancellationToken cancellationToken)
    {
        Problem = null;

        var current = await _actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Schedule.ReadCurrentSlotAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var slots = await _actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Schedule.ListScheduleAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (slots is null)
        {
            return;
        }

        // The slot the station is actually airing, which is not always the one the clock says:
        // a hold keeps a broadcast past its slot deliberately.
        var airing = current?.AiringSlotId;

        Slots.Clear();
        foreach (var slot in slots.Slots.OrderBy(s => s.StartsAtMinutes))
        {
            Slots.Add(new SlotViewModel(
                slot.Id,
                DaysOf(slot.Days),
                $"{StationTime.Clock(slot.StartsAtMinutes)}–{StationTime.EndClock(slot.EndsAtMinutes)}",
                slot.Label,
                slot.Brief,
                string.Equals(slot.Id, airing, StringComparison.Ordinal)));
        }

        if (Slots.Count == 0)
        {
            Problem = "Nothing is scheduled. The station plays its sustaining source.";
        }
    }

    /// <summary>The weekday numbers, as names. Absent or complete means every day.</summary>
    private static string DaysOf(List<long>? days)
    {
        if (days is null || days.Count == 0 || days.Count >= 7)
        {
            return "Every day";
        }

        var names = StationTime.WeekdayNames;
        return string.Join(", ", days.Select(day => names[Math.Clamp((int)day, 0, names.Count - 1)]));
    }

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = _http,
    });
}
