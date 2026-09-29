using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One character in a file, and what importing it would do to it.</summary>
public sealed record PersonaImportRowViewModel(string Label, bool IsCaller, string LandsAs, string Stories, string Notices)
{
    public bool HasNotices => Notices.Length > 0;
}

/// <summary>
/// What a persona file would do here, read before anything is written.
/// </summary>
/// <remarks>
/// The file was read once, when it was chosen, and it is THAT document that is sent on accept rather
/// than the file on disk again, which somebody may have replaced in between. An import is all or
/// nothing on the station's side, so a failure leaves the dialog open with nothing changed.
/// </remarks>
public sealed class PersonaImportDialogViewModel : DialogViewModel
{
    private readonly OperatorActions _actions;
    private readonly HttpClient _http;
    private readonly StationUrl _station;
    private readonly PersonaFile _file;
    private readonly PersonaImportPlan _plan;

    public PersonaImportDialogViewModel(
        OperatorActions actions,
        HttpClient http,
        StationUrl station,
        string name,
        PersonaFile file,
        PersonaImportPlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);

        _actions = actions;
        _http = http;
        _station = station;
        _file = file;
        _plan = plan;
        Name = name;

        Rows = plan.Personas.Select(entry => new PersonaImportRowViewModel(
            entry.Label,
            entry.Kind == PersonaImportEntryKind.Caller,
            entry.Outcome == PersonaImportEntryOutcome.Create ? "New" : "Rewrite",
            PersonaRoster.StoryLine(entry.StoriesNew, entry.StoriesHeld),
            string.Join('\n', entry.Notices.Select(notice => notice.Message)))).ToList();

        Notices = string.Join('\n', plan.Notices.Select(notice => notice.Message));
    }

    public override string Title => "Import personas";

    public override string AcceptLabel => _plan.Personas.Count == 0 ? "Import" : PersonaRoster.ImportLabel(_plan);

    /// <summary>A file of nobody imports nothing, so there is nothing to press.</summary>
    public override bool CanAccept => _plan.Personas.Count > 0;

    /// <summary>The file's name, so the dialog says which one it read.</summary>
    public string Name { get; }

    public static string Intro =>
        "Characters are matched by their key: one this station already has is rewritten and its stories are added to, and one "
        + "it does not is created. Nothing is ever deleted, and nobody is put on air.";

    public IReadOnlyList<PersonaImportRowViewModel> Rows { get; }

    /// <summary>The file's own notices, in the station's sentences, one per line.</summary>
    public string Notices { get; }

    public bool HasNotices => Notices.Length > 0;

    /// <summary>What the import did, once it has.</summary>
    public PersonaImportResult? Result { get; private set; }

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        Result = await _actions.RunAsync(
            async token =>
            {
                using var sdk = VoiceTabViewModel.Sdk(_station, _http);
                return await sdk.Personas.ImportPersonasAsync(_file, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        return Result is not null;
    }
}
