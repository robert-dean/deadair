using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One name the station says differently from how it is written.</summary>
public sealed record PronunciationRowViewModel(Pronunciation Entry)
{
    public string Written => Entry.Written;

    /// <summary>What the engine is handed. Empty drops the words, which is said rather than shown blank.</summary>
    public string Spoken => Entry.Spoken.Length == 0 ? "not said" : Entry.Spoken;

    public bool IsDropped => Entry.Spoken.Length == 0;

    /// <summary>The sentence that says so, which is what a proposal is decided on. Only for one nobody here typed.</summary>
    public string? Evidence => Entry.Origin == PronunciationOrigin.Operator ? null : Entry.SourceQuote;

    public string? SourceUrl => Entry.SourceUrl;

    public bool IsProposed => Entry.State == PronunciationState.Suggested;

    public bool IsActive => Entry.State == PronunciationState.Active;

    public bool IsRejected => Entry.State == PronunciationState.Rejected;
}

/// <summary>
/// The names the station would otherwise read wrongly.
/// </summary>
/// <remarks>
/// <para>
/// Three sections, the notebook's: what the station proposed from articles it already holds, what is
/// said this way, and what was turned down. Nothing proposed is said until it is accepted, because an
/// article's key is often about one word of a name and sometimes about a different name entirely.
/// </para>
/// <para>
/// Turned down is a state, not a delete, and "Say it" brings one back: deleting it would let the same
/// article propose it again, forever. An entry in use is taken out of use by deleting it, and that asks.
/// </para>
/// </remarks>
public sealed partial class PronunciationsViewModel(OperatorActions actions, HttpClient http, IDialogs dialogs)
    : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<PronunciationRowViewModel> Proposed { get; } = [];

    public ObservableCollection<PronunciationRowViewModel> Active { get; } = [];

    public ObservableCollection<PronunciationRowViewModel> TurnedDown { get; } = [];

    public bool HasProposed => Proposed.Count > 0;

    public bool HasTurnedDown => TurnedDown.Count > 0;

    public bool IsEmpty => Active.Count == 0;

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Render.ListPronunciationsAsync(cancellationToken: token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is not null)
        {
            Present(list.Pronunciations);
        }
    }

    public void Present(IEnumerable<Pronunciation> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);

        Proposed.Clear();
        Active.Clear();
        TurnedDown.Clear();
        foreach (var entry in entries)
        {
            var row = new PronunciationRowViewModel(entry);
            (entry.State switch
            {
                PronunciationState.Suggested => Proposed,
                PronunciationState.Rejected => TurnedDown,
                _ => Active,
            }).Add(row);
        }

        OnPropertyChanged(nameof(HasProposed));
        OnPropertyChanged(nameof(HasTurnedDown));
        OnPropertyChanged(nameof(IsEmpty));
    }

    [RelayCommand]
    private async Task AddAsync()
    {
        var dialog = new PronunciationDialogViewModel(Actions, Http, Station, null);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } list)
        {
            Notice = $"The station says {dialog.Written.Trim()} your way from the next break on.";
            Present(list.Pronunciations);
        }
    }

    [RelayCommand]
    private async Task EditAsync(PronunciationRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var dialog = new PronunciationDialogViewModel(Actions, Http, Station, row.Entry);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } list)
        {
            Notice = $"Saved {dialog.Written.Trim()}.";
            Present(list.Pronunciations);
        }
    }

    [RelayCommand]
    private async Task DeleteAsync(PronunciationRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (!Guid.TryParse(row.Entry.Id, out var id)
            || !await dialogs.ConfirmAsync(
                $"Stop saying {row.Written} that way?",
                $"The station reads it as \"{row.Entry.Spoken}\" today, and will say it however the engine does once this is gone.",
                "Delete").ConfigureAwait(true))
        {
            return;
        }

        await WriteAsync((sdk, token) => sdk.Render.DeletePronunciationAsync(id, token)).ConfigureAwait(true);
    }

    /// <summary>Accepts a proposal, or brings back one that was turned down.</summary>
    [RelayCommand]
    private Task SayAsync(PronunciationRowViewModel row) => SetStateAsync(row, PronunciationStateWriteState.Active);

    /// <summary>Turns a proposal down. Kept rather than deleted, so the same article does not propose it again.</summary>
    [RelayCommand]
    private Task TurnDownAsync(PronunciationRowViewModel row) => SetStateAsync(row, PronunciationStateWriteState.Rejected);

    private async Task SetStateAsync(PronunciationRowViewModel row, PronunciationStateWriteState state)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (Guid.TryParse(row.Entry.Id, out var id))
        {
            await WriteAsync((sdk, token) => sdk.Render.SetPronunciationStateAsync(id, new PronunciationStateWrite { State = state }, token))
                .ConfigureAwait(true);
        }
    }

    private async Task WriteAsync(Func<DeadairSdk, CancellationToken, Task<PronunciationList>> write)
    {
        var list = await RunAsync(write).ConfigureAwait(true);
        if (list is not null)
        {
            Present(list.Pronunciations);
        }
    }
}

/// <summary>
/// A name and how to say it. The right-hand side is handed to the engine untouched, so it is written
/// however that engine reads best, and empty drops the words.
/// </summary>
public sealed partial class PronunciationDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly StationUrl _station;
    private readonly Pronunciation? _entry;

    public PronunciationDialogViewModel(OperatorActions actions, HttpClient http, StationUrl station, Pronunciation? entry)
    {
        _actions = actions;
        _http = http;
        _station = station;
        _entry = entry;
        _written = entry?.Written ?? string.Empty;
        _spoken = entry?.Spoken ?? string.Empty;
    }

    public override string Title => _entry is null ? "Say a name differently" : $"Edit {_entry.Written}";

    public override string AcceptLabel => _entry is null ? "Add" : "Save";

    public override bool CanAccept => Written.Trim().Length > 0;

    [ObservableProperty]
    private string _written;

    [ObservableProperty]
    private string _spoken;

    public PronunciationList? Result { get; private set; }

    partial void OnWrittenChanged(string value) => Revalidate();

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        var body = new PronunciationWrite { Written = Written.Trim(), Spoken = Spoken.Trim() };
        var existing = _entry is not null && Guid.TryParse(_entry.Id, out var parsed) ? parsed : (Guid?)null;

        Result = await _actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                return existing is { } id
                    ? await sdk.Render.UpdatePronunciationAsync(id, body, token).ConfigureAwait(false)
                    : await sdk.Render.CreatePronunciationAsync(body, token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [409] = $"The station already says {body.Written} some way. Edit that one instead." },
            cancellationToken).ConfigureAwait(true);

        return Result is not null;
    }
}
