using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One release and what changed in it.</summary>
/// <param name="Badge">"This station" on the release it is running, "Not installed" on a newer one.</param>
/// <param name="Page">Its page on GitHub, which only a release the station does not contain has.</param>
public sealed record ReleaseCardViewModel(string Version, string? Date, string? Badge, Uri? Page, string Notes)
{
    public bool HasNotes => Notes.Length > 0;
}

/// <summary>
/// The What's new tab: what changed in each release this station contains, and anything newer.
/// </summary>
/// <remarks>
/// <para>
/// The releases it contains come from the changelog the build carries, so they answer with no
/// internet. The newer ones are what the station last heard from GitHub, drawn first and set apart,
/// because they are why somebody came here after an upgrade notice.
/// </para>
/// <para>
/// <b>Check now is the one manage-only thing on it.</b> It makes the station send a request to the
/// internet, which the reads do not. A refusal is said on the tab, beside the button, rather than as
/// "no longer an operator" at the foot of the page, because an account that can read releases and
/// not ask for them IS still an operator, of a smaller kind.
/// </para>
/// </remarks>
public sealed partial class ReleasesViewModel(OperatorActions actions, Func<DeadairSdk> sdk) : ObservableObject
{
    private List<StationRelease> _notes = [];
    private string? _current;

    public ObservableCollection<ReleaseCardViewModel> Available { get; } = [];

    public ObservableCollection<ReleaseCardViewModel> Notes { get; } = [];

    [ObservableProperty]
    private bool _loaded;

    [ObservableProperty]
    private string? _problem;

    /// <summary>Whether the station is looking for newer releases at all.</summary>
    [ObservableProperty]
    private bool _checks;

    /// <summary>
    /// Whether it is looking and when it last heard, said rather than left to the absence of a newer
    /// release: "nothing newer" and "not looking" read identically otherwise, and only one of them is
    /// something the operator chose.
    /// </summary>
    [ObservableProperty]
    private string _checkLine = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(CheckNowCommand))]
    private bool _checking;

    /// <summary>What the last Check now found, or why it could not be asked.</summary>
    [ObservableProperty]
    private string? _outcome;

    [ObservableProperty]
    private string? _availableHeading;

    [ObservableProperty]
    private string? _empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowOlderLabel))]
    [NotifyPropertyChangedFor(nameof(HasOlder))]
    private int _older;

    public bool HasOlder => Older > 0;

    public string ShowOlderLabel => Older == 1 ? "Show 1 older release" : $"Show {Older} older releases";

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        var releases = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Station.ReadStationReleasesAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (releases is null)
        {
            Problem = Loaded ? null : "The release notes could not be fetched.";
            return;
        }

        Show(releases, all: false);
        Outcome = null;
    }

    [RelayCommand(CanExecute = nameof(CanCheck))]
    private async Task CheckNowAsync(CancellationToken cancellationToken)
    {
        Checking = true;
        Outcome = null;
        try
        {
            var reply = await ManageOnly.RunAsync(
                actions,
                async token =>
                {
                    using var client = sdk();
                    return await client.Station.CheckStationReleasesAsync(token).ConfigureAwait(false);
                },
                cancellationToken).ConfigureAwait(true);

            if (reply.Refused)
            {
                Outcome = "This account cannot ask the station to check. Somebody who manages the station can.";
                return;
            }

            if (reply.Value is { } releases)
            {
                Show(releases, all: Notes.Count > ReleaseCheck.Shown);
                Outcome = ReleaseCheck.Outcome(releases, DateTimeOffset.UtcNow);
            }
        }
        finally
        {
            Checking = false;
        }
    }

    private bool CanCheck() => !Checking;

    [RelayCommand]
    private void ShowOlder() => Fill(all: true);

    private void Show(StationReleases releases, bool all)
    {
        _notes = releases.Notes;
        _current = releases.Current;
        Checks = releases.Checks;

        // No button while the check is off: it would send nothing, and pressing it would look like an
        // answer.
        CheckLine = !releases.Checks
            ? "The station is not checking for newer releases. Turn it on under Settings, Station."
            : releases.CheckedAt is { } heard
                ? $"The station checks GitHub for newer releases every few hours. It last heard back {heard.ToLocalTime().ToString("d MMM yyyy, HH:mm", CultureInfo.InvariantCulture)}."
                : "The station checks GitHub for newer releases every few hours, and has not heard back yet.";

        Available.Clear();
        foreach (var release in releases.Available)
        {
            Available.Add(Card(release, "Not installed"));
        }

        // An eyebrow, so in capitals in the text itself, as every eyebrow in this app is.
        AvailableHeading = releases.Available.Count switch
        {
            0 => null,
            1 => "OUT, AND NOT ON THIS STATION YET",
            var count => $"{count} RELEASES OUT, AND NOT ON THIS STATION YET",
        };

        Fill(all);
        Empty = _notes.Count == 0 ? "This build carries no changelog, so there is nothing to say about what changed in it." : null;
        Loaded = true;
        Problem = null;
    }

    private void Fill(bool all)
    {
        var shown = all ? _notes : _notes.Take(ReleaseCheck.Shown).ToList();

        Notes.Clear();
        foreach (var release in shown)
        {
            Notes.Add(Card(release, release.Version == _current ? "This station" : null));
        }

        Older = _notes.Count - shown.Count;
    }

    private static ReleaseCardViewModel Card(StationRelease release, string? badge) => new(
        release.Version,

        // The SDK reads the day as a date with no zone, so it is the same day wherever it is read.
        release.Date?.ToString("d MMM yyyy", CultureInfo.InvariantCulture),
        badge,
        Uri.TryCreate(release.Url, UriKind.Absolute, out var page) ? page : null,
        ReleaseCheck.PlainNotes(release.Notes));
}
