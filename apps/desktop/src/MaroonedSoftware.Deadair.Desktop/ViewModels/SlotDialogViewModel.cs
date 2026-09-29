using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One weekday's toggle in the slot editor.</summary>
public sealed partial class DayToggleViewModel(int day, string name, bool chosen, Action changed) : ObservableObject
{
    public int Day { get; } = day;

    public string Name { get; } = name;

    [ObservableProperty]
    private bool _isChosen = chosen;

    partial void OnIsChosenChanged(bool value) => changed();
}

public sealed record ChartOrderChoice(ScheduleSlotSourceChartOrder Value, string Label);

public sealed record ModeChoice(ScheduleSlotMode Value, string Label);

public sealed record OnEndChoice(ScheduleSlotOnEnd Value, string Label);

/// <summary>
/// Writing one slot of the station's day, in a dialog.
/// </summary>
/// <remarks>
/// <para>
/// Through a dialog and never by dragging. The web console drags blocks on a grid, and a wrong drop
/// there is a broadcast rescheduled; here a change is something typed and then saved, the way the
/// running order's edits are buttons.
/// </para>
/// <para>
/// When it is on is a sentence (put the breakfast show on weekdays from six until ten); what it plays
/// is a list of separate choices underneath, the same fields the web console shares between a slot,
/// the desk and the sustaining source. Nothing here changes what is on air now: a saved slot takes
/// effect when it next comes round.
/// </para>
/// </remarks>
public sealed partial class SlotDialogViewModel : DialogViewModel
{
    private readonly bool _isNew;
    private readonly Func<ScheduleSlotInput, CancellationToken, Task<bool>> _save;

    public SlotDialogViewModel(
        SlotDraft draft,
        bool isNew,
        bool airing,
        IReadOnlyList<SourceChoice> sources,
        IReadOnlyList<HostChoice> hosts,
        Func<ScheduleSlotInput, CancellationToken, Task<bool>> save)
    {
        ArgumentNullException.ThrowIfNull(draft);
        ArgumentNullException.ThrowIfNull(sources);
        ArgumentNullException.ThrowIfNull(hosts);

        _isNew = isNew;
        _save = save;
        IsAiring = airing;
        Sources = sources;
        Hosts = hosts;

        _label = draft.Label;
        _startsAt = draft.StartsAt;
        _endsAt = draft.EndsAt;
        _source = sources.FirstOrDefault(choice => choice.Source == draft.Source) ?? sources[0];
        _chartOrder = ChartOrders.First(choice => choice.Value == draft.ChartOrder);
        _host = hosts.FirstOrDefault(choice => choice.Id == draft.PersonaId) ?? hosts[0];
        _brief = draft.Brief;
        _eraFrom = draft.EraFrom;
        _eraTo = draft.EraTo;
        _callins = draft.Callins;
        _mixInSimilar = draft.MixInSimilar;
        _mode = Modes.First(choice => choice.Value == draft.Mode);
        _onEnd = OnEnds.First(choice => choice.Value == draft.OnEnd);

        Days = [.. StationTime.WeekdayNames.Select((name, day) => new DayToggleViewModel(day, name, draft.Days.Contains(day), Changed))];
    }

    public override string Title => _isNew ? "New slot" : "Edit slot";

    /// <summary>Whether this is the slot the running order belongs to right now.</summary>
    public bool IsAiring { get; }

    public IReadOnlyList<DayToggleViewModel> Days { get; }

    public IReadOnlyList<SourceChoice> Sources { get; }

    public IReadOnlyList<HostChoice> Hosts { get; }

    public IReadOnlyList<ChartOrderChoice> ChartOrders { get; } =
    [
        new(ScheduleSlotSourceChartOrder.Countdown, "Countdown, ending on number one"),
        new(ScheduleSlotSourceChartOrder.Ranked, "Number one first"),
        new(ScheduleSlotSourceChartOrder.Unordered, "No fixed order"),
    ];

    public IReadOnlyList<ModeChoice> Modes { get; } =
    [
        new(ScheduleSlotMode.Rotation, "Rotation"),
        new(ScheduleSlotMode.Setlist, "Setlist"),
        new(ScheduleSlotMode.Feature, "Feature"),
    ];

    public IReadOnlyList<OnEndChoice> OnEnds { get; } =
    [
        new(ScheduleSlotOnEnd.Extend, "Keep going"),
        new(ScheduleSlotOnEnd.Repeat, "Start again"),
        new(ScheduleSlotOnEnd.Stop, "Stop"),
    ];

    [ObservableProperty]
    private string _label;

    [ObservableProperty]
    private string _startsAt;

    [ObservableProperty]
    private string _endsAt;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsChart), nameof(MixesIn))]
    private SourceChoice _source;

    [ObservableProperty]
    private ChartOrderChoice _chartOrder;

    [ObservableProperty]
    private HostChoice _host;

    [ObservableProperty]
    private string _brief;

    [ObservableProperty]
    private string _eraFrom;

    [ObservableProperty]
    private string _eraTo;

    [ObservableProperty]
    private bool _callins;

    [ObservableProperty]
    private bool _mixInSimilar;

    [ObservableProperty]
    private ModeChoice _mode;

    [ObservableProperty]
    private OnEndChoice _onEnd;

    /// <summary>Only under a chart, because it means nothing under anything else.</summary>
    public bool IsChart => Source.Source is ProgrammeSource.Chart;

    /// <summary>Only beside a playlist, the station's or a provider's: nothing else is mixed into.</summary>
    public bool MixesIn => ProgrammeSource.MixesInto(Source.Source);

    /// <summary>What the times mean, or that no day chosen is every day.</summary>
    public string Reading
    {
        get
        {
            var days = Days.Any(day => day.IsChosen) ? string.Empty : "No day chosen is every day. ";
            return days + (Draft().Reading() ?? "Times are 24-hour, on the station's own clock.");
        }
    }

    /// <summary>What stops this being saved, said under the fields while it is true.</summary>
    public string? Hint => Draft().Problem();

    public override bool CanAccept => Hint is null;

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken) =>
        Draft().ToInput() is { } input && await _save(input, cancellationToken).ConfigureAwait(true);

    /// <summary>What the fields say, as the rules read it.</summary>
    public SlotDraft Draft() => new()
    {
        Label = Label,
        StartsAt = StartsAt,
        EndsAt = EndsAt,
        Days = Days.Where(day => day.IsChosen).Select(day => day.Day).ToHashSet(),
        Source = Source.Source,
        ChartOrder = ChartOrder.Value,
        PersonaId = Host.Id,
        Brief = Brief,
        EraFrom = EraFrom,
        EraTo = EraTo,
        Callins = Callins,
        MixInSimilar = MixInSimilar,
        Mode = Mode.Value,
        OnEnd = OnEnd.Value,
    };

    partial void OnLabelChanged(string value) => Changed();

    partial void OnStartsAtChanged(string value) => Changed();

    partial void OnEndsAtChanged(string value) => Changed();

    partial void OnBriefChanged(string value) => Changed();

    partial void OnEraFromChanged(string value) => Changed();

    partial void OnEraToChanged(string value) => Changed();

    private void Changed()
    {
        OnPropertyChanged(nameof(Hint));
        OnPropertyChanged(nameof(Reading));
        Revalidate();
    }
}
