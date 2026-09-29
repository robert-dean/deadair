using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One rule of the format clock, as its row draws it.</summary>
/// <param name="Badge">"Off", or that nothing can produce it, or null for an ordinary band.</param>
/// <param name="BadgeHint">Why the badge is there, as its tooltip.</param>
public sealed record BandRowViewModel(
    ClockBand Band,
    int Index,
    string When,
    string What,
    string? Badge,
    string? BadgeHint,
    bool CanMoveUp,
    bool CanMoveDown)
{
    public bool IsOff => !Band.Enabled;
}

/// <summary>
/// The Today tab: what is on now, and the shape of the hour.
/// </summary>
/// <remarks>
/// <para>
/// Two halves of one question. The on-now strip is what the station is PLAYING, in words, because
/// the question somebody arrives with is "what is on" and reading it off a week of rows is work. The
/// format clock is what it SAYS inside the hour, a bulletin at half past, an ident at the top, and a
/// band is a rule about every hour, which is why it is a list here and not something on a timetable.
/// </para>
/// <para>
/// Everything is read when the tab is opened and after a write, never on a timer: the station
/// answers every clock write with the whole clock, so a save redraws from what it said.
/// </para>
/// </remarks>
public sealed partial class TodayViewModel(OperatorActions actions, Func<DeadairSdk> sdk, IDialogs dialogs) : ObservableObject
{
    private List<ClockBand> _bands = [];
    private List<string> _producible = [];

    /// <summary>The block on now (or the gap), and the two after it.</summary>
    public ObservableCollection<OnNowCell> OnNow { get; } = [];

    public ObservableCollection<BandRowViewModel> Bands { get; } = [];

    /// <summary>What the dial draws. A new list on every change, so the dial redraws.</summary>
    [ObservableProperty]
    private IReadOnlyList<DialMark> _marks = [];

    [ObservableProperty]
    private bool _hasOnNow;

    [ObservableProperty]
    private bool _hasBands;

    /// <summary>Whether the clock has been read at all, so an empty list is said only when it is true.</summary>
    [ObservableProperty]
    private bool _clockRead;

    /// <summary>The stored slots, which the strip needs for the brief and host a block does not carry.</summary>
    public IReadOnlyList<ScheduleSlot> Slots { get; private set; } = [];

    /// <summary>The slot the running order belongs to, which the editor warns about.</summary>
    public string? AiringSlotId { get; private set; }

    /// <summary>Raised when a block on the strip asks for its editor, with the stored slot.</summary>
    public event Func<ScheduleSlot, Task>? EditSlotRequested;

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        var current = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Schedule.ReadCurrentSlotAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var slots = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Schedule.ListScheduleAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        // For the host's name on the strip, and nothing else.
        var personas = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Personas.ListPersonasAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (current is not null)
        {
            PresentOnNow(current, slots?.Slots ?? Slots, personas?.Personas ?? []);
        }

        var clock = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Clock.ListClockBandsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (clock is not null)
        {
            PresentClock(clock);
        }
    }

    /// <summary>Draws a reading of the station's clock.</summary>
    public void PresentOnNow(ScheduleNow current, IReadOnlyList<ScheduleSlot> slots, IReadOnlyList<Persona> personas)
    {
        ArgumentNullException.ThrowIfNull(current);

        Slots = slots;
        AiringSlotId = current.AiringSlotId;
        OnNow.Clear();
        foreach (var cell in Core.Programme.OnNow.Cells(current, Slots, personas))
        {
            OnNow.Add(cell);
        }

        HasOnNow = OnNow.Count > 0;
    }

    /// <summary>Draws the clock the station answered with, which every clock write answers with in full.</summary>
    public void PresentClock(ClockBandList clock)
    {
        ArgumentNullException.ThrowIfNull(clock);

        _bands = [.. clock.Bands];
        _producible = [.. clock.ProducibleKinds];

        Bands.Clear();
        for (var index = 0; index < _bands.Count; index++)
        {
            var band = _bands[index];
            var what = band.TopicLabel is { } topic ? $"{band.Kind} · {topic}" : band.Kind;

            // A rule switched off says nothing about whether the station could honour it, so only
            // one badge is ever worth drawing: what an operator does about a band that is off is
            // turn it on.
            var (badge, hint) = !band.Enabled
                ? ("Off", "Switched off: kept, and not acted on.")
                : FormatClock.CanProduce(band.Kind, _producible)
                    ? ((string?)null, (string?)null)
                    : ("nothing can produce this",
                        $"Nothing on this station can make a {band.Kind}. The slot is claimed and then passed over, so the station plays on rather than saying anything.");

            Bands.Add(new BandRowViewModel(
                band,
                index,
                FormatClock.WhenOf(band),
                what,
                badge,
                hint,
                index > 0,
                index < _bands.Count - 1));
        }

        Marks = FormatClock.Marks(_bands, _producible);
        HasBands = Bands.Count > 0;
        ClockRead = true;
    }

    /// <summary>
    /// Opens the slot editor on the block a cell names: the change somebody wants after reading what
    /// is on is usually to the answer, and finding the block again on the Timetable is a tab away.
    /// </summary>
    [RelayCommand]
    private async Task EditSlotAsync(OnNowCell cell)
    {
        if (cell.SlotId is { } id && Slots.FirstOrDefault(slot => slot.Id == id) is { } slot && EditSlotRequested is { } edit)
        {
            await edit(slot).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private Task AddBandAsync(CancellationToken cancellationToken) =>
        OpenBandAsync(null, cancellationToken);

    [RelayCommand]
    private Task EditBandAsync(BandRowViewModel row, CancellationToken cancellationToken) =>
        OpenBandAsync(row.Band, cancellationToken);

    [RelayCommand]
    private async Task DeleteBandAsync(BandRowViewModel row, CancellationToken cancellationToken)
    {
        var confirmed = await dialogs.ConfirmAsync(
            $"Delete the {row.Band.Kind} band at {row.When}?",
            "The station stops claiming that boundary from its next pass. Breaks already planned stay where they are.",
            "Delete").ConfigureAwait(true);

        if (!confirmed)
        {
            return;
        }

        var clock = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Clock.DeleteClockBandAsync(row.Band.Id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (clock is not null)
        {
            PresentClock(clock);
        }
    }

    [RelayCommand]
    private Task MoveUpAsync(BandRowViewModel row, CancellationToken cancellationToken) => MoveAsync(row, -1, cancellationToken);

    [RelayCommand]
    private Task MoveDownAsync(BandRowViewModel row, CancellationToken cancellationToken) => MoveAsync(row, 1, cancellationToken);

    /// <summary>
    /// Swaps a band with its neighbour: two writes, the second landing on what the first produced.
    /// </summary>
    /// <remarks>
    /// Order is preference (two rules wanting one boundary is settled by which is higher), and it is
    /// the only thing about a band that is moved rather than edited. Buttons rather than dragging, as
    /// the running order's are.
    /// </remarks>
    private async Task MoveAsync(BandRowViewModel row, int by, CancellationToken cancellationToken)
    {
        foreach (var (id, body) in FormatClock.Swap(_bands, row.Index, by))
        {
            var clock = await actions.RunAsync(
                async token =>
                {
                    using var client = sdk();
                    return await client.Clock.UpdateClockBandAsync(id, body, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (clock is null)
            {
                return;
            }

            PresentClock(clock);
        }
    }

    private async Task OpenBandAsync(ClockBand? band, CancellationToken cancellationToken)
    {
        // The subjects are read as the dialog opens, since nothing else on the tab needs them. A
        // station that cannot list them still gets the dialog, with no subject row.
        var topics = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Topics.ListTopicsAsync(null, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        var dialog = new ClockBandDialogViewModel(
            BandDraft.From(band, FormatClock.NextPosition(_bands)),
            isNew: band is null,
            FormatClock.Kinds(_producible),
            topics?.Topics ?? [],
            async (input, token) =>
            {
                var clock = await actions.RunAsync(
                    async inner =>
                    {
                        using var client = sdk();
                        return band is null
                            ? await client.Clock.CreateClockBandAsync(input, inner).ConfigureAwait(false)
                            : await client.Clock.UpdateClockBandAsync(band.Id, input, inner).ConfigureAwait(false);
                    },
                    cancellationToken: token).ConfigureAwait(true);

                if (clock is null)
                {
                    return false;
                }

                PresentClock(clock);
                return true;
            });

        await dialogs.ShowAsync(dialog).ConfigureAwait(true);
    }
}
