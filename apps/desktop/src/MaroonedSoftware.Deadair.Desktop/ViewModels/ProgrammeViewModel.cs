using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One slot in the week.</summary>
public sealed record SlotViewModel(string Id, string Days, string Window, string Label, string? Brief, bool IsAiring);

/// <summary>
/// What the station is scheduled to do, and what it is doing now.
/// </summary>
/// <remarks>
/// <para>
/// Read-only for the moment. Editing a timetable wants dragging and resizing, and a wrong drop
/// reschedules a broadcast — so the read comes first and is worth having on its own, which is the
/// order the running order's edits arrived in too.
/// </para>
/// <para>
/// A slot's times are MINUTES FROM MIDNIGHT rather than clock strings, and its days are a list of
/// weekday numbers rather than one day, because a slot recurs. Rendering both is this file's whole
/// job beyond fetching.
/// </para>
/// </remarks>
public sealed partial class ProgrammeViewModel(OperatorActions actions, HttpClient http) : ObservableObject
{
    private static readonly string[] DayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    private StationUrl _station;

    public ObservableCollection<SlotViewModel> Slots { get; } = [];

    [ObservableProperty]
    private string _onNow = "Nothing scheduled.";

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _problem;

    public void Attach(StationUrl station) => _station = station;

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        Problem = null;

        try
        {
            var current = await actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();
                    return await sdk.Schedule.ReadCurrentSlotAsync(token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            var slots = await actions.RunAsync(
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
                    $"{Clock(slot.StartsAtMinutes)}–{Clock(slot.EndsAtMinutes)}",
                    slot.Label,
                    slot.Brief,
                    string.Equals(slot.Id, airing, StringComparison.Ordinal)));
            }

            OnNow = Slots.FirstOrDefault(slot => slot.IsAiring) is { } onAir
                ? $"{onAir.Label}, {onAir.Window}"
                : "Nothing scheduled is on air right now.";

            if (Slots.Count == 0)
            {
                Problem = "Nothing is scheduled. The station plays its sustaining service.";
            }
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Minutes from midnight, as a clock.</summary>
    /// <remarks>
    /// A slot may end at 1440, which is midnight at the far end of the day rather than the near one.
    /// Formatting it as 00:00 would draw a slot that appears to end before it starts.
    /// </remarks>
    private static string Clock(long minutes)
    {
        var wrapped = minutes >= 1440;
        var value = TimeSpan.FromMinutes(wrapped ? minutes - 1440 : minutes);

        return wrapped && value == TimeSpan.Zero
            ? "24:00"
            : value.ToString(@"hh\:mm", CultureInfo.InvariantCulture);
    }

    /// <summary>The weekday numbers, as names. Absent or complete means every day.</summary>
    private static string DaysOf(List<long>? days)
    {
        if (days is null || days.Count == 0 || days.Count >= 7)
        {
            return "Every day";
        }

        return string.Join(", ", days.Select(day => DayNames[Math.Clamp((int)day, 0, DayNames.Length - 1)]));
    }

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = http,
    });
}
