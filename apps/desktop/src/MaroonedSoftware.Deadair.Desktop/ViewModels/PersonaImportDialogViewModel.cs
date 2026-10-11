using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Sdk.Clients;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One character in a file, and what importing it would do to it.</summary>
/// <remarks>
/// A character this station already holds is skipped until <see cref="Replace"/> is ticked. The plan
/// gave it the counts and notices a replace would get, so ticking it changes what the row says
/// without asking the station again.
/// </remarks>
public sealed partial class PersonaImportRowViewModel : ObservableObject
{
    private readonly string _stories;
    private readonly string _notices;
    private readonly Action _changed;

    public PersonaImportRowViewModel(string key, string label, bool isCaller, bool isHeld, string stories, string notices, Action changed)
    {
        Key = key;
        Label = label;
        IsCaller = isCaller;
        IsHeld = isHeld;
        _stories = stories;
        _notices = notices;
        _changed = changed;
    }

    public string Key { get; }

    public string Label { get; }

    public bool IsCaller { get; }

    /// <summary>Whether this station already has a character under this key, which is what offers the choice.</summary>
    public bool IsHeld { get; }

    /// <summary>Whether the operator chose to rewrite the character already here. Off is the safe answer.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(LandsAs), nameof(Stories), nameof(Notices), nameof(HasNotices))]
    private bool _replace;

    public bool IsSkipped => IsHeld && !Replace;

    public string LandsAs => !IsHeld ? "New" : Replace ? "Rewrite" : "Skipped";

    public string Stories => IsSkipped ? "–" : _stories;

    /// <summary>What a skipped character's notices describe is a replace that is not going to happen, so they wait.</summary>
    public string Notices => IsSkipped ? "" : _notices;

    public bool HasNotices => Notices.Length > 0;

    partial void OnReplaceChanged(bool value) => _changed();
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
            entry.Key,
            entry.Label,
            entry.Kind == PersonaImportEntryKind.Caller,
            entry.Outcome != PersonaImportEntryOutcome.Create,
            PersonaRoster.StoryLine(entry.StoriesNew, entry.StoriesHeld),
            string.Join('\n', entry.Notices.Select(notice => notice.Message)),
            Chosen)).ToList();

        Notices = string.Join('\n', plan.Notices.Select(notice => notice.Message));

        var held = Rows.Count(row => row.IsHeld);
        HeldNotice = held == 0 ? ""
            : $"{held} of these {(held == 1 ? "is" : "are")} already here. Skipping leaves yours exactly as it is. "
                + "Tick Replace to rewrite it with the one in this file.";
    }

    public override string Title => "Import personas";

    public override string AcceptLabel => PersonaRoster.ImportLabel(Rows.Count(row => !row.IsHeld), Rows.Count(row => row.IsHeld && row.Replace));

    /// <summary>A file whose every character is new to nobody and skipped imports nothing, so there is nothing to press.</summary>
    public override bool CanAccept => Rows.Any(row => !row.IsSkipped);

    /// <summary>Said once, above the rows, when any character in the file is one this station already has.</summary>
    public string HeldNotice { get; }

    public bool HasHeldNotice => HeldNotice.Length > 0;

    /// <summary>The file's name, so the dialog says which one it read.</summary>
    public string Name { get; }

    public static string Intro =>
        "Characters are matched by their key. One this station does not have is created. One it already has is skipped unless "
        + "you tick Replace, which rewrites its sheet and adds its stories. Nothing is ever deleted, and nobody is put on air.";

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
                var replace = Rows.Where(row => row.IsHeld && row.Replace).Select(row => row.Key).ToList();
                return await sdk.Personas.ImportPersonasAsync(_file, replace.Count == 0 ? null : new ImportPersonasQuery { Replace = replace }, token)
                    .ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        return Result is not null;
    }

    /// <summary>A row's choice moved, so the button's words and whether it can be pressed may have too.</summary>
    private void Chosen()
    {
        OnPropertyChanged(nameof(AcceptLabel));
        Revalidate();
    }
}
