using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One slot in the week.</summary>
public sealed record SlotViewModel(string Id, string Days, string Window, string Label, string? Brief, bool IsAiring)
{
    /// <summary>The stored slot, which is what the editor opens on. Absent for a posed row.</summary>
    public ScheduleSlot? Slot { get; init; }
}

/// <summary>
/// The Timetable tab: the blocks across the week, edited through a dialog, and the rule for what
/// happens at a boundary.
/// </summary>
/// <remarks>
/// <para>
/// A list of slots rather than a week grid. A slot recurs, so its days are a list and its times are
/// minutes from midnight; the list says exactly that, where a grid of seven columns draws the same
/// block seven times. The web console's grid is where it drags, and dragging is left out here on
/// purpose: a wrong drop reschedules a broadcast.
/// </para>
/// <para>
/// The ON AIR marker follows <c>airingSlotId</c> rather than the time, because a hold keeps a broadcast
/// past its slot deliberately and the slot the clock names is then not the one on air.
/// </para>
/// </remarks>
public sealed partial class TimetableViewModel : ObservableObject
{
    /// <summary>The two settings the web console draws under its grid, in its order.</summary>
    public static readonly IReadOnlyList<string> OverrunKeys = ["schedule.capOverrun", "schedule.overrunMinutes"];

    private readonly OperatorActions _actions;
    private readonly Func<DeadairSdk> _sdk;
    private readonly IDialogs _dialogs;
    private string? _airing;

    public TimetableViewModel(OperatorActions actions, Func<DeadairSdk> sdk, IDialogs dialogs)
    {
        _actions = actions;
        _sdk = sdk;
        _dialogs = dialogs;
        Overrun = new SettingsSubsetViewModel(actions, sdk, OverrunKeys);
    }

    public ObservableCollection<SlotViewModel> Slots { get; } = [];

    /// <summary>Whether a block starts when the timetable says, or when the record before it ends.</summary>
    public SettingsSubsetViewModel Overrun { get; }

    [ObservableProperty]
    private string? _problem;

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        var current = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.Schedule.ReadCurrentSlotAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var slots = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.Schedule.ListScheduleAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (slots is not null)
        {
            Present(slots, current?.AiringSlotId);
        }

        await Overrun.LoadAsync(cancellationToken).ConfigureAwait(true);
    }

    /// <summary>Draws the schedule the station answered with, which every slot write answers with in full.</summary>
    public void Present(ScheduleSlotList slots, string? airing)
    {
        ArgumentNullException.ThrowIfNull(slots);

        _airing = airing;
        Slots.Clear();
        foreach (var slot in slots.Slots.OrderBy(slot => slot.StartsAtMinutes))
        {
            Slots.Add(new SlotViewModel(
                slot.Id,
                SlotText.When(slot),
                SlotText.Window(slot.StartsAtMinutes, slot.EndsAtMinutes),
                string.IsNullOrWhiteSpace(slot.Label) ? "Untitled" : slot.Label,
                slot.Brief,
                string.Equals(slot.Id, airing, StringComparison.Ordinal))
            {
                Slot = slot,
            });
        }

        Problem = Slots.Count == 0
            ? "Nothing is scheduled, which is an ordinary state rather than a fault: the station plays its sustaining source. Add a slot to give a stretch of the day a show of its own."
            : null;
    }

    [RelayCommand]
    private async Task AddSlotAsync(CancellationToken cancellationToken) =>
        await EditAsync(null, _airing, cancellationToken).ConfigureAwait(true);

    [RelayCommand]
    private async Task EditSlotAsync(SlotViewModel row, CancellationToken cancellationToken)
    {
        if (row.Slot is { } slot)
        {
            await EditAsync(slot, _airing, cancellationToken).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private async Task DeleteSlotAsync(SlotViewModel row, CancellationToken cancellationToken)
    {
        var confirmed = await _dialogs.ConfirmAsync(
            $"Delete {row.Label}?",
            row.IsAiring
                ? "It comes off the timetable. It is on air now, and what it put on keeps playing until the next block begins."
                : "It comes off the timetable, and those hours play the sustaining source unless another block covers them.",
            "Delete").ConfigureAwait(true);

        if (!confirmed)
        {
            return;
        }

        var slots = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.Schedule.DeleteScheduleSlotAsync(row.Id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (slots is not null)
        {
            Present(slots, _airing);
        }
    }

    /// <summary>
    /// Opens the slot editor on a slot, or on a new one, and answers whether it was saved.
    /// </summary>
    /// <remarks>
    /// The choices are read as it opens (the hosts, the station's playlists, the providers' and the
    /// charts), because nothing else on the tab needs them. One that cannot be read leaves its part of
    /// a picker empty rather than keeping the dialog shut. Public because the on-now strip opens the
    /// same editor on the block it names.
    /// </remarks>
    public async Task<bool> EditAsync(ScheduleSlot? slot, string? airing, CancellationToken cancellationToken)
    {
        var personas = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.Personas.ListPersonasAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var owned = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.StationPlaylists.ListStationPlaylistsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var playlists = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.Playlists.ListImportablePlaylistsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var charts = await _actions.RunAsync(
            async token =>
            {
                using var client = _sdk();
                return await client.Charts.ListChartsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var draft = SlotDraft.From(slot);
        var dialog = new SlotDialogViewModel(
            draft,
            isNew: slot is null,
            airing: slot is not null && string.Equals(slot.Id, airing, StringComparison.Ordinal),
            SourceChoices.Build(owned?.Playlists ?? [], playlists?.Playlists ?? [], charts?.Charts ?? [], draft.Source),
            Hosts(personas?.Personas ?? [], draft.PersonaId),
            async (input, token) =>
            {
                var saved = await _actions.RunAsync(
                    async inner =>
                    {
                        using var client = _sdk();
                        return slot is null
                            ? await client.Schedule.CreateScheduleSlotAsync(input, inner).ConfigureAwait(false)
                            : await client.Schedule.UpdateScheduleSlotAsync(slot.Id, input, inner).ConfigureAwait(false);
                    },
                    cancellationToken: token).ConfigureAwait(true);

                if (saved is null)
                {
                    return false;
                }

                Present(saved, airing);
                return true;
            });

        return await _dialogs.ShowAsync(dialog).ConfigureAwait(true);
    }

    /// <summary>
    /// The characters who can host: never a caller, who phones in to a production and cannot be put
    /// on air. Whoever the slot already names is kept, so a picker never draws a saved host as none.
    /// </summary>
    public static IReadOnlyList<HostChoice> Hosts(IEnumerable<Persona> personas, string? chosen)
    {
        ArgumentNullException.ThrowIfNull(personas);

        var hosts = new List<HostChoice> { new(null, "The station's own host") };
        foreach (var persona in personas)
        {
            if (persona.Kind != PersonaKind.Caller || persona.Id == chosen)
            {
                hosts.Add(new HostChoice(persona.Id, persona.Label));
            }
        }

        if (chosen is not null && hosts.All(host => host.Id != chosen))
        {
            hosts.Add(new HostChoice(chosen, chosen));
        }

        return hosts;
    }
}
