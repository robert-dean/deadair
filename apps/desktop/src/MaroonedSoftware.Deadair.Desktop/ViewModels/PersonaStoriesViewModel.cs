using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One part of a story in parts, or one detail of any story.</summary>
/// <param name="Text">What is shown: a proposal says so in front of its words.</param>
/// <param name="IsNext">The part that goes out next, which is the first part in use.</param>
public sealed record StoryPieceViewModel(string Id, string Text, string? Ordinal, bool IsProposed, bool IsNext);

/// <summary>One story on a character's shelf, editable in place.</summary>
public sealed partial class PersonaStoryRowViewModel : ObservableObject
{
    public PersonaStoryRowViewModel(PersonaStory story)
    {
        ArgumentNullException.ThrowIfNull(story);

        Story = story;

        // Only a part in use is ever told, so the first of those is the one that goes out next. A
        // turned-down one is not drawn at all: it is kept only so the pass does not propose it again.
        var beats = story.Beats.Where(beat => beat.State != PersonaStoryBeatState.Rejected).OrderBy(beat => beat.Ordinal).ToList();
        var next = beats.FirstOrDefault(beat => beat.State == PersonaStoryBeatState.Active);
        Beats = beats
            .Select(beat => new StoryPieceViewModel(
                beat.Id,
                beat.State == PersonaStoryBeatState.Suggested ? $"proposed: {beat.Beat}" : beat.Beat,
                beat.Ordinal.ToString(System.Globalization.CultureInfo.InvariantCulture),
                beat.State == PersonaStoryBeatState.Suggested,
                ReferenceEquals(beat, next)))
            .ToList();

        Details = story.Details
            .Where(detail => detail.State != PersonaStoryDetailState.Rejected)
            .Select(detail => new StoryPieceViewModel(
                detail.Id,
                detail.State == PersonaStoryDetailState.Suggested ? $"proposed: {detail.Detail}" : $"· {detail.Detail}",
                null,
                detail.State == PersonaStoryDetailState.Suggested,
                false))
            .ToList();
    }

    public PersonaStory Story { get; }

    public string Title => Story.Title;

    public string Text => Story.Story;

    public string Told => PersonaMemoryText.Told(Story.TimesTold);

    public bool ByStation => Story.Origin == PersonaStoryOrigin.Model;

    /// <summary>Where a proposal's idea came from. Never evidence: a story is not a claim about the world.</summary>
    public string? Source => string.IsNullOrEmpty(Story.Source) ? null : $"from {Story.Source}";

    public bool IsProposed => Story.State == PersonaStoryState2.Suggested;

    public bool IsActive => Story.State == PersonaStoryState2.Active;

    public bool IsRejected => Story.State == PersonaStoryState2.Rejected;

    public bool IsArc => Story.Kind == PersonaStoryKind.Arc;

    public IReadOnlyList<StoryPieceViewModel> Beats { get; }

    public IReadOnlyList<StoryPieceViewModel> Details { get; }

    public bool CanEdit => !Editing;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanEdit))]
    private bool _editing;

    [ObservableProperty]
    private string _draftTitle = string.Empty;

    [ObservableProperty]
    private string _draftStory = string.Empty;

    [ObservableProperty]
    private DialOption? _draftKind;

    /// <summary>The next part, typed under the parts there are.</summary>
    [ObservableProperty]
    private string _newBeat = string.Empty;

    [ObservableProperty]
    private string _newDetail = string.Empty;

    [RelayCommand]
    private void Edit()
    {
        DraftTitle = Story.Title;
        DraftStory = Story.Story;
        DraftKind = PersonaStoriesViewModel.Kinds.FirstOrDefault(kind => kind.Value == Wire.Name<PersonaStoryKind>(Story.Kind))
            ?? PersonaStoriesViewModel.Kinds[0];
        Editing = true;
    }

    [RelayCommand]
    private void StopEditing() => Editing = false;
}

/// <summary>
/// Things that have happened to one character, told on air.
/// </summary>
/// <remarks>
/// The same three sections as the notebook, for its reasons: proposals first, then what can be told,
/// then what was turned down and is kept only so it is not proposed again. A story changed from a
/// one-off into a story in parts is how one ordinarily starts; changing it back leaves its parts where
/// they are rather than deleting them.
/// </remarks>
public sealed partial class PersonaStoriesViewModel(OperatorActions actions, HttpClient http, string personaId)
    : VoiceTabViewModel(actions, http)
{
    public static IReadOnlyList<DialOption> Kinds { get; } =
    [
        new("anecdote", "A one-off: told whole, whenever it comes round"),
        new("arc", "A story in parts: one part per break, in order"),
        new("bit", "A running joke: returned to and built on, with no end"),
    ];

    public ObservableCollection<PersonaStoryRowViewModel> Proposed { get; } = [];

    public ObservableCollection<PersonaStoryRowViewModel> Tellable { get; } = [];

    public ObservableCollection<PersonaStoryRowViewModel> TurnedDown { get; } = [];

    public bool HasProposed => Proposed.Count > 0;

    public bool HasTurnedDown => TurnedDown.Count > 0;

    public bool IsEmpty => Tellable.Count == 0;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(AddCommand))]
    private string _newTitle = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(AddCommand))]
    private string _newStory = string.Empty;

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Personas.ListPersonaStoriesAsync(personaId, token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is not null)
        {
            Present(list);
        }
    }

    public void Present(PersonaStoryList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        Proposed.Clear();
        Tellable.Clear();
        TurnedDown.Clear();
        foreach (var story in list.Stories)
        {
            var row = new PersonaStoryRowViewModel(story);
            (row.IsProposed ? Proposed : row.IsActive ? Tellable : TurnedDown).Add(row);
        }

        OnPropertyChanged(nameof(HasProposed));
        OnPropertyChanged(nameof(HasTurnedDown));
        OnPropertyChanged(nameof(IsEmpty));
    }

    [RelayCommand(CanExecute = nameof(CanAdd))]
    private async Task AddAsync()
    {
        if (await WriteAsync((sdk, token) => sdk.Personas.WritePersonaStoryAsync(
                personaId,
                new PersonaStoryWrite { Title = NewTitle.Trim(), Story = NewStory.Trim() },
                token)).ConfigureAwait(true))
        {
            NewTitle = string.Empty;
            NewStory = string.Empty;
        }
    }

    private bool CanAdd() => NewTitle.Trim().Length > 0 && NewStory.Trim().Length > 0;

    [RelayCommand]
    private async Task SaveEditAsync(PersonaStoryRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (row.DraftTitle.Trim().Length == 0 || row.DraftStory.Trim().Length == 0)
        {
            return;
        }

        await WriteAsync((sdk, token) => sdk.Personas.UpdatePersonaStoryAsync(
            personaId,
            row.Story.Id,
            new PersonaStoryWrite
            {
                Title = row.DraftTitle.Trim(),
                Story = row.DraftStory.Trim(),
                Kind = Wire.Parse<PersonaStoryWriteKind>(row.DraftKind?.Value),
            },
            token)).ConfigureAwait(true);
    }

    [RelayCommand]
    private Task AcceptAsync(PersonaStoryRowViewModel row) => SetStateAsync(row, PersonaStoryStateState.Active);

    /// <summary>Not a delete: the pass reads the same catalogue back and would propose it again.</summary>
    [RelayCommand]
    private Task RejectAsync(PersonaStoryRowViewModel row) => SetStateAsync(row, PersonaStoryStateState.Rejected);

    [RelayCommand]
    private async Task DeleteAsync(PersonaStoryRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);
        await WriteAsync((sdk, token) => sdk.Personas.DeletePersonaStoryAsync(personaId, row.Story.Id, token)).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task AddBeatAsync(PersonaStoryRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (row.NewBeat.Trim().Length == 0)
        {
            return;
        }

        var ordinal = PersonaMemoryText.NextOrdinal(row.Story.Beats);
        await WriteAsync((sdk, token) => sdk.Personas.AddPersonaStoryBeatAsync(
            personaId,
            row.Story.Id,
            new PersonaStoryBeatWrite { Ordinal = ordinal, Beat = row.NewBeat.Trim() },
            token)).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task AddDetailAsync(PersonaStoryRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (row.NewDetail.Trim().Length == 0)
        {
            return;
        }

        await WriteAsync((sdk, token) => sdk.Personas.AddPersonaStoryDetailAsync(
            personaId,
            row.Story.Id,
            new PersonaStoryDetailWrite { Detail = row.NewDetail.Trim() },
            token)).ConfigureAwait(true);
    }

    /// <summary>Keeps a proposed part or detail. The piece's parent story is found by id.</summary>
    [RelayCommand]
    private Task KeepPieceAsync(StoryPieceViewModel piece) => PieceAsync(piece, PersonaStoryStateState.Active);

    [RelayCommand]
    private Task RejectPieceAsync(StoryPieceViewModel piece) => PieceAsync(piece, PersonaStoryStateState.Rejected);

    [RelayCommand]
    private Task DeletePieceAsync(StoryPieceViewModel piece) => PieceAsync(piece, state: null);

    private async Task PieceAsync(StoryPieceViewModel piece, PersonaStoryStateState? state)
    {
        ArgumentNullException.ThrowIfNull(piece);

        var story = Proposed.Concat(Tellable).Concat(TurnedDown).FirstOrDefault(row =>
            row.Beats.Contains(piece) || row.Details.Contains(piece));
        if (story is null)
        {
            return;
        }

        var storyId = story.Story.Id;
        var body = state is { } set ? new PersonaStoryState { State = set } : null;

        await (story.Beats.Contains(piece)
            ? WriteAsync((sdk, token) => body is null
                ? sdk.Personas.DeletePersonaStoryBeatAsync(personaId, storyId, piece.Id, token)
                : sdk.Personas.SetPersonaStoryBeatStateAsync(personaId, storyId, piece.Id, body, token))
            : WriteAsync((sdk, token) => body is null
                ? sdk.Personas.DeletePersonaStoryDetailAsync(personaId, storyId, piece.Id, token)
                : sdk.Personas.SetPersonaStoryDetailStateAsync(personaId, storyId, piece.Id, body, token))).ConfigureAwait(true);
    }

    private async Task SetStateAsync(PersonaStoryRowViewModel row, PersonaStoryStateState state)
    {
        ArgumentNullException.ThrowIfNull(row);
        await WriteAsync((sdk, token) => sdk.Personas.SetPersonaStoryStateAsync(personaId, row.Story.Id, new PersonaStoryState { State = state }, token))
            .ConfigureAwait(true);
    }

    /// <summary>Every write answers the whole shelf, which is redrawn from it.</summary>
    private async Task<bool> WriteAsync(Func<DeadairSdk, CancellationToken, Task<PersonaStoryList>> write)
    {
        if (Busy)
        {
            return false;
        }

        Busy = true;
        try
        {
            var list = await RunAsync(write).ConfigureAwait(true);
            if (list is null)
            {
                return false;
            }

            Present(list);
            return true;
        }
        finally
        {
            Busy = false;
        }
    }
}
