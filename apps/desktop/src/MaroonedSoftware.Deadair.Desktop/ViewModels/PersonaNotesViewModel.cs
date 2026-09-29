using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One note in a character's notebook, editable in place.
/// </summary>
/// <remarks>
/// A proposal is editable as much as a note in use, because half the value of the nightly pass is a
/// line that is nearly right: somebody who can only accept or reject a nearly-right sentence rejects
/// it, and the observation goes with the wording.
/// </remarks>
public sealed partial class NoteRowViewModel(PersonaNote note) : ObservableObject
{
    public PersonaNote Note { get; } = note;

    public string Text => Note.Note;

    public string Kind => Note.Kind == PersonaNoteKind.Trait ? "settled into" : "said before";

    /// <summary>Whether the station wrote it rather than somebody here.</summary>
    public bool ByStation => Note.Origin == PersonaNoteOrigin.Model;

    /// <summary>What the station actually said, which is what a proposal is judged on.</summary>
    public string? Quote => string.IsNullOrEmpty(Note.SourceQuote) ? null : $"“{Note.SourceQuote}”";

    public bool IsProposed => Note.State == PersonaNoteState2.Suggested;

    public bool IsActive => Note.State == PersonaNoteState2.Active;

    public bool IsRejected => Note.State == PersonaNoteState2.Rejected;

    /// <summary>A turned-down note has nothing to edit: it is not in use.</summary>
    public bool CanEdit => !IsRejected && !Editing;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanEdit))]
    private bool _editing;

    [ObservableProperty]
    private string _draft = string.Empty;

    [RelayCommand]
    private void Edit()
    {
        Draft = Text;
        Editing = true;
    }

    [RelayCommand]
    private void StopEditing() => Editing = false;
}

/// <summary>
/// What one character has accumulated beyond its sheet.
/// </summary>
/// <remarks>
/// <para>
/// Proposals come first because they are the only thing here waiting on a person; everything below is
/// already in use. A notebook that buried three proposals under twenty notes would be one where the
/// nightly pass quietly stopped mattering.
/// </para>
/// <para>
/// Reject and delete are different verbs and neither section offers both. A turned-down note outlives
/// the pass that proposed it; delete a proposal and the next pass over the same scripts writes it
/// again, forever.
/// </para>
/// </remarks>
public sealed partial class PersonaNotesViewModel(OperatorActions actions, HttpClient http, string personaId)
    : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<NoteRowViewModel> Proposed { get; } = [];

    public ObservableCollection<NoteRowViewModel> InUse { get; } = [];

    public ObservableCollection<NoteRowViewModel> TurnedDown { get; } = [];

    public bool HasProposed => Proposed.Count > 0;

    public bool HasTurnedDown => TurnedDown.Count > 0;

    public bool IsEmpty => InUse.Count == 0;

    public static IReadOnlyList<DialOption> Kinds { get; } =
    [
        new("trait", "Settled into"),
        new("said", "Said before"),
    ];

    /// <summary>What the next note is. Written by hand, it is in use from the moment it exists.</summary>
    [ObservableProperty]
    private DialOption _newKind = Kinds[0];

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(AddCommand))]
    private string _newNote = string.Empty;

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Personas.ListPersonaNotesAsync(personaId, token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is not null)
        {
            Present(list);
        }
    }

    public void Present(PersonaNoteList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        Proposed.Clear();
        InUse.Clear();
        TurnedDown.Clear();
        foreach (var note in list.Notes)
        {
            var row = new NoteRowViewModel(note);
            (row.IsProposed ? Proposed : row.IsActive ? InUse : TurnedDown).Add(row);
        }

        OnPropertyChanged(nameof(HasProposed));
        OnPropertyChanged(nameof(HasTurnedDown));
        OnPropertyChanged(nameof(IsEmpty));
    }

    [RelayCommand(CanExecute = nameof(CanAdd))]
    private Task AddAsync() => WriteAsync(async (sdk, token) =>
    {
        var written = await sdk.Personas.WritePersonaNoteAsync(
            personaId,
            new PersonaNoteWrite { Kind = NewKind.Value == "said" ? PersonaNoteWriteKind.Said : PersonaNoteWriteKind.Trait, Note = NewNote.Trim() },
            token).ConfigureAwait(false);
        return written;
    }, clear: true);

    private bool CanAdd() => NewNote.Trim().Length > 0;

    [RelayCommand]
    private Task AcceptAsync(NoteRowViewModel row) => SetStateAsync(row, PersonaNoteStateState.Active);

    /// <summary>Not a delete: a deleted proposal comes back on the next pass over the same scripts.</summary>
    [RelayCommand]
    private Task RejectAsync(NoteRowViewModel row) => SetStateAsync(row, PersonaNoteStateState.Rejected);

    [RelayCommand]
    private Task DeleteAsync(NoteRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return WriteAsync((sdk, token) => sdk.Personas.DeletePersonaNoteAsync(personaId, row.Note.Id, token));
    }

    [RelayCommand]
    private Task SaveEditAsync(NoteRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (row.Draft.Trim().Length == 0)
        {
            return Task.CompletedTask;
        }

        var kind = row.Note.Kind == PersonaNoteKind.Said ? PersonaNoteWriteKind.Said : PersonaNoteWriteKind.Trait;
        return WriteAsync((sdk, token) => sdk.Personas.UpdatePersonaNoteAsync(
            personaId,
            row.Note.Id,
            new PersonaNoteWrite { Kind = kind, Note = row.Draft.Trim() },
            token));
    }

    private Task SetStateAsync(NoteRowViewModel row, PersonaNoteStateState state)
    {
        ArgumentNullException.ThrowIfNull(row);
        return WriteAsync((sdk, token) => sdk.Personas.SetPersonaNoteStateAsync(personaId, row.Note.Id, new PersonaNoteState { State = state }, token));
    }

    /// <summary>Every write answers the whole notebook, which is redrawn from it.</summary>
    private async Task WriteAsync(Func<DeadairSdk, CancellationToken, Task<PersonaNoteList>> write, bool clear = false)
    {
        if (Busy)
        {
            return;
        }

        Busy = true;
        try
        {
            var list = await RunAsync(write).ConfigureAwait(true);
            if (list is not null)
            {
                Present(list);
                if (clear)
                {
                    NewNote = string.Empty;
                }
            }
        }
        finally
        {
            Busy = false;
        }
    }
}
