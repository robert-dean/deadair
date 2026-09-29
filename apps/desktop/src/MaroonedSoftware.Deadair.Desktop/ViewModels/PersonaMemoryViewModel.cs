using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Clients;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One telling on a character's timeline.
/// </summary>
/// <remarks>
/// Whether it was TOLD is drawn rather than assumed: a story offered to the writer and passed over is
/// an ordinary outcome, and the row records that the character was handed it and said nothing.
/// </remarks>
public sealed record TellingRowViewModel(PersonaTelling Telling)
{
    public string Title => Telling.Title;

    public string? Said => Telling.Said;

    public string When => PersonaMemoryText.Moment(Telling.AiredAt ?? Telling.At);

    public bool PassedOver => !Telling.Told;

    public bool NotAired => Telling.AiredAt is null;
}

/// <summary>
/// What a character has actually told, and the way back.
/// </summary>
/// <remarks>
/// The timeline IS the control: a rollback is chosen by pointing at a row, "back to before this",
/// because the moment that matters is always just before the thing somebody did not like, and the
/// moment handed back is the row's own string rather than one retyped from it.
/// </remarks>
public sealed partial class PersonaMemoryViewModel(
    OperatorActions actions,
    HttpClient http,
    IDialogs dialogs,
    string personaId,
    string label) : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<TellingRowViewModel> Tellings { get; } = [];

    public bool IsEmpty => Tellings.Count == 0;

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var timeline = await RunAsync((sdk, token) => sdk.Personas.ReadPersonaMemoryAsync(personaId, token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (timeline is not null)
        {
            Present(timeline.Tellings);
        }
    }

    public void Present(IEnumerable<PersonaTelling> tellings)
    {
        Tellings.Clear();
        foreach (var telling in tellings)
        {
            Tellings.Add(new TellingRowViewModel(telling));
        }

        OnPropertyChanged(nameof(IsEmpty));
    }

    /// <summary>Undoes everything after one telling. The telling itself stays.</summary>
    [RelayCommand]
    private Task RollBackAsync(TellingRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return AskAsync(row.Telling.At, $"Roll {label} back to before this?", $"Everything after {row.When} goes. That telling itself stays.");
    }

    /// <summary>Clears everything the character accumulated on its own. What anybody wrote by hand stays.</summary>
    [RelayCommand]
    private Task ClearAllAsync() => AskAsync(null, $"Clear everything {label} has accumulated?", null);

    /// <summary>
    /// Nothing happens without the preview: the dialog asks the station what it would undo and shows
    /// the counts before its button does anything.
    /// </summary>
    private async Task AskAsync(string? to, string title, string? after)
    {
        var preview = await RunAsync((sdk, token) => sdk.Personas.PreviewPersonaMemoryRollbackAsync(
            personaId,
            new PreviewPersonaMemoryRollbackQuery { To = to },
            token)).ConfigureAwait(true);

        if (preview is null)
        {
            return;
        }

        var dialog = new PersonaRollbackDialogViewModel(Actions, Http, Station, personaId, to, title, after, preview);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } memory)
        {
            Notice = "Rolled back. Only what the station wrote itself went.";
            Present(memory.Tellings);
        }
    }
}

/// <summary>
/// A rollback, with what it would undo counted before it is done.
/// </summary>
/// <remarks>
/// Re-learning starts clear and is a separate question. Dragging the nightly pass's watermark back is
/// right when somebody is testing and wrong when they are undoing a character that drifted: the second
/// wants the conclusions gone, and re-reading the window invites tonight's pass to reach them again.
/// </remarks>
public sealed partial class PersonaRollbackDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly StationUrl _station;
    private readonly string _personaId;
    private readonly string? _to;
    private readonly string _title;
    private readonly PersonaMemoryChange _change;

    public PersonaRollbackDialogViewModel(
        OperatorActions actions,
        HttpClient http,
        StationUrl station,
        string personaId,
        string? to,
        string title,
        string? after,
        PersonaMemoryChange change)
    {
        ArgumentNullException.ThrowIfNull(change);

        _actions = actions;
        _http = http;
        _station = station;
        _personaId = personaId;
        _to = to;
        _title = title;
        _change = change;
        After = after;
        Summary = string.Join('\n', PersonaMemoryText.Summary(change));
    }

    public override string Title => _title;

    public override string AcceptLabel => _to is null ? "Clear it" : "Roll back";

    public override string CancelLabel => "Leave it";

    public override bool Destructive => true;

    /// <summary>Nothing to undo is nothing to press.</summary>
    public override bool CanAccept => _change.Tellings + _change.Notes + _change.Stories + _change.Details > 0;

    public string? After { get; }

    public bool HasAfter => After is not null;

    public string Summary { get; }

    /// <summary>Whether tonight's pass reads the same broadcasts again, from scratch.</summary>
    [ObservableProperty]
    private bool _relearn;

    public PersonaMemory? Result { get; private set; }

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        Result = await _actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                return await sdk.Personas.RollBackPersonaMemoryAsync(
                    _personaId,
                    new PersonaMemoryRollback { To = _to, Relearn = Relearn ? true : null },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        return Result is not null;
    }
}
