using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One way a band can be said, as the picker offers it.</summary>
public sealed record BandWhenChoice(BandWhen When, string Label);

/// <summary>A subject a band can be about, or none.</summary>
public sealed record TopicChoice(string? Id, string Label);

/// <summary>
/// Writing one rule of the station's format clock.
/// </summary>
/// <remarks>
/// <para>
/// A band is a sentence ("say a news every hour at :30"), so the dialog draws it as one: a kind, a
/// way of saying when, and whichever of minute, time or spacing that way needs. The kind is free text
/// with the station's producible kinds as suggestions, because a station that wants sponsor spots
/// writes <c>sponsor</c> and drops the recordings in.
/// </para>
/// <para>
/// The subject picker is drawn only when the kind typed above HAS subjects: a news band can be about
/// a category and a talk break cannot be about anything, and an empty picker on every band would be a
/// control that means nothing four times out of five.
/// </para>
/// </remarks>
public sealed partial class ClockBandDialogViewModel : DialogViewModel
{
    private readonly bool _isNew;
    private readonly IReadOnlyList<Topic> _topics;
    private readonly Func<ClockBandInput, CancellationToken, Task<bool>> _save;
    private readonly long _position;

    public ClockBandDialogViewModel(
        BandDraft draft,
        bool isNew,
        IReadOnlyList<string> kinds,
        IReadOnlyList<Topic> topics,
        Func<ClockBandInput, CancellationToken, Task<bool>> save)
    {
        ArgumentNullException.ThrowIfNull(draft);

        _isNew = isNew;
        _topics = topics;
        _save = save;
        _position = draft.Position;
        Kinds = kinds;

        _kind = draft.Kind;
        _when = WhenChoices.First(choice => choice.When == draft.When);
        _minute = draft.Minute;
        _time = draft.Time;
        _everyMinutes = draft.EveryMinutes;
        _enabled = draft.Enabled;

        RefreshSubjects(draft.TopicId);
    }

    public override string Title => _isNew ? "New band" : "Edit band";

    public IReadOnlyList<string> Kinds { get; }

    public IReadOnlyList<BandWhenChoice> WhenChoices { get; } =
    [
        new(BandWhen.Hourly, "every hour at"),
        new(BandWhen.Daily, "once a day at"),
        new(BandWhen.Interval, "every"),
    ];

    [ObservableProperty]
    private string _kind;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsHourly), nameof(IsDaily), nameof(IsInterval))]
    private BandWhenChoice _when;

    [ObservableProperty]
    private string _minute;

    [ObservableProperty]
    private string _time;

    [ObservableProperty]
    private string _everyMinutes;

    [ObservableProperty]
    private bool _enabled;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSubjects))]
    private IReadOnlyList<TopicChoice> _subjects = [];

    [ObservableProperty]
    private TopicChoice? _subject;

    public bool IsHourly => When.When == BandWhen.Hourly;

    public bool IsDaily => When.When == BandWhen.Daily;

    public bool IsInterval => When.When == BandWhen.Interval;

    public bool HasSubjects => Subjects.Count > 1;

    /// <summary>What stops this being saved, said under the fields while it is true.</summary>
    public string? Hint => Draft().Problem();

    public override bool CanAccept => Hint is null;

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken) =>
        Draft().ToInput() is { } input && await _save(input, cancellationToken).ConfigureAwait(true);

    /// <summary>What the fields say, as the rules read it.</summary>
    public BandDraft Draft() => new()
    {
        Kind = Kind,
        When = When.When,
        Minute = Minute,
        Time = Time,
        EveryMinutes = EveryMinutes,
        TopicId = HasSubjects ? Subject?.Id : null,
        Position = _position,
        Enabled = Enabled,
    };

    partial void OnKindChanged(string value)
    {
        // Switching the kind switches what it can be about, so the list follows the live field.
        RefreshSubjects(Subject?.Id);
        Changed();
    }

    partial void OnWhenChanged(BandWhenChoice value) => Changed();

    partial void OnMinuteChanged(string value) => Changed();

    partial void OnTimeChanged(string value) => Changed();

    partial void OnEveryMinutesChanged(string value) => Changed();

    private void Changed()
    {
        OnPropertyChanged(nameof(Hint));
        Revalidate();
    }

    private void RefreshSubjects(string? keep)
    {
        var subjects = FormatClock.Subjects(_topics, Kind ?? string.Empty);
        Subjects = [new TopicChoice(null, "Whatever it finds"), .. subjects.Select(topic => new TopicChoice(topic.Id, topic.Label))];
        Subject = Subjects.FirstOrDefault(choice => choice.Id == keep) ?? Subjects[0];
    }
}
