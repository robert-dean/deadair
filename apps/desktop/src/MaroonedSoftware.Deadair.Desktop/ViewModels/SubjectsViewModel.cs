using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One subject the station can talk about.</summary>
public sealed record SubjectRowViewModel(Topic Topic, TopicKindDescriptor Kind)
{
    public string Label => Topic.Label;

    public string Summary => TopicConfig.Summary(Topic, Kind);
}

/// <summary>One kind of subject, and the subjects of that kind the station holds.</summary>
public sealed record SubjectKindViewModel(TopicKindDescriptor Kind, IReadOnlyList<SubjectRowViewModel> Subjects)
{
    public string Heading => Kind.NounMany;

    public string Description => Kind.Description;

    public string NewLabel => $"New {Kind.NounOne}";

    public bool IsEmpty => Subjects.Count == 0;

    public string Empty => $"No {Kind.NounMany} yet.";
}

/// <summary>
/// What the station has to talk about: the categories a bulletin can cover, the places a weather
/// break can be about.
/// </summary>
/// <remarks>
/// On this page on the operator's question rather than the API's shape. A subject is not speech and
/// has no voice, but it is what the station HAS to talk about, and somebody editing what the station
/// says is exactly who needs it. Each kind declares its own fields, so a kind added upstream appears
/// here with no code, drawn by the same form every declared field in the app is drawn by.
/// </remarks>
public sealed partial class SubjectsViewModel(OperatorActions actions, HttpClient http, IDialogs dialogs)
    : VoiceTabViewModel(actions, http)
{
    private List<ClockBand> _bands = [];

    public ObservableCollection<SubjectKindViewModel> Kinds { get; } = [];

    public bool HasNoKinds => Kinds.Count == 0;

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var kinds = await RunAsync((sdk, token) => sdk.Topics.ListTopicKindsAsync(token), cancellationToken: cancellationToken).ConfigureAwait(true);
        var topics = await RunAsync((sdk, token) => sdk.Topics.ListTopicsAsync(cancellationToken: token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        // Which clock bands name each subject, so deleting one can say what it leaves without one.
        var clock = await RunAsync((sdk, token) => sdk.Clock.ListClockBandsAsync(token), cancellationToken: cancellationToken).ConfigureAwait(true);
        _bands = clock?.Bands ?? _bands;

        if (kinds is not null && topics is not null)
        {
            Present(kinds.Kinds, topics.Topics);
        }
    }

    public void Present(IReadOnlyList<TopicKindDescriptor> kinds, IReadOnlyList<Topic> topics)
    {
        ArgumentNullException.ThrowIfNull(kinds);
        ArgumentNullException.ThrowIfNull(topics);

        Kinds.Clear();
        foreach (var kind in kinds)
        {
            Kinds.Add(new SubjectKindViewModel(
                kind,
                [.. topics.Where(topic => topic.Kind == kind.Kind).OrderBy(topic => topic.Position).Select(topic => new SubjectRowViewModel(topic, kind))]));
        }

        OnPropertyChanged(nameof(HasNoKinds));
    }

    private void Present(TopicList list)
    {
        var kinds = Kinds.Select(kind => kind.Kind).ToList();
        Present(kinds, list.Topics);
    }

    [RelayCommand]
    private async Task NewAsync(SubjectKindViewModel kind)
    {
        ArgumentNullException.ThrowIfNull(kind);

        var position = kind.Subjects.Count == 0 ? 0 : kind.Subjects.Max(subject => subject.Topic.Position) + 1;
        var dialog = new TopicDialogViewModel(Actions, Http, Station, kind.Kind, null, position);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } list)
        {
            Notice = $"Added {dialog.Label.Trim()}.";
            Present(list);
        }
    }

    [RelayCommand]
    private async Task EditAsync(SubjectRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var dialog = new TopicDialogViewModel(Actions, Http, Station, row.Kind, row.Topic, row.Topic.Position);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } list)
        {
            Notice = $"Saved {dialog.Label.Trim()}.";
            Present(list);
        }
    }

    [RelayCommand]
    private async Task DeleteAsync(SubjectRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var bands = _bands.Count(band => band.TopicId == row.Topic.Id);
        var consequence = bands switch
        {
            0 => "Nothing on the clock names it, so nothing else changes.",
            1 => "One band on the clock names it, and goes back to being about anything.",
            _ => $"{bands} bands on the clock name it, and go back to being about anything.",
        };

        if (!await dialogs.ConfirmAsync($"Delete {row.Label}?", consequence, "Delete").ConfigureAwait(true))
        {
            return;
        }

        var list = await RunAsync((sdk, token) => sdk.Topics.DeleteTopicAsync(row.Topic.Id, token)).ConfigureAwait(true);
        if (list is not null)
        {
            Notice = $"Deleted {row.Label}.";
            Present(list);
        }
    }
}

/// <summary>
/// One subject: its name and whatever its kind declares, drawn by the shared form.
/// </summary>
/// <remarks>
/// The key a new subject is born with is its name, as the console does, and an existing subject keeps
/// the key it has: a clock band names a subject by it.
/// </remarks>
public sealed partial class TopicDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly StationUrl _station;
    private readonly TopicKindDescriptor _kind;
    private readonly Topic? _topic;
    private readonly long _position;

    public TopicDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station, TopicKindDescriptor kind, Topic? topic, long position)
    {
        ArgumentNullException.ThrowIfNull(kind);

        _actions = actions;
        _http = http;
        _station = station;
        _kind = kind;
        _topic = topic;
        _position = position;
        _label = topic?.Label ?? string.Empty;

        // Typed, as a plugin's configuration is: the station stores what is sent exactly as sent.
        Form = new ConfigFormViewModel(kind.Fields.Select(FormField.From), TopicConfig.Stored(kind, topic), new Dictionary<string, bool>(), FormEncoding.Typed);
    }

    public override string Title => _topic is null ? $"New {_kind.NounOne}" : $"Edit {_topic.Label}";

    public override bool CanAccept => Label.Trim().Length > 0;

    public ConfigFormViewModel Form { get; }

    public string? Key => _topic is null ? null : $"Its key is {_topic.Key}, which is what the clock names it by, and stays.";

    public string NameHelp => $"What the {_kind.NounOne} is called on this page and in the clock.";

    [ObservableProperty]
    private string _label;

    public TopicList? Result { get; private set; }

    partial void OnLabelChanged(string value) => Revalidate();

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        if (Form.Problem() is { } problem)
        {
            Problem = problem;
            return false;
        }

        var body = new TopicInput
        {
            Kind = _kind.Kind,
            Key = _topic?.Key ?? Label.Trim(),
            Label = Label.Trim(),
            Config = TopicConfig.Merge(_topic, Form.Submission()),
            Position = _position,
        };

        Result = await _actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                return _topic is null
                    ? await sdk.Topics.CreateTopicAsync(body, token).ConfigureAwait(false)
                    : await sdk.Topics.UpdateTopicAsync(_topic.Id, body, token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [409] = $"There is already a {_kind.NounOne} called {body.Label}." },
            cancellationToken).ConfigureAwait(true);

        return Result is not null;
    }
}
