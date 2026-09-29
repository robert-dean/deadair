using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One piece of audio the station holds.</summary>
public sealed partial class SegmentRowViewModel(string id, string label, string kind, string state, StatusTone tone, bool canPlay)
    : ObservableObject
{
    public string Id { get; } = id;

    public string Label { get; } = label;

    public string Kind { get; } = kind;

    public string State { get; } = state;

    public StatusTone Tone { get; } = tone;

    /// <summary>Only a segment with audio behind it has anything to play.</summary>
    public bool CanPlay { get; } = canPlay;

    /// <summary>The kind, above the first row of each: an ident and a talk break are different jobs.</summary>
    public string? Heading { get; init; }

    public bool HasHeading => Heading is not null;

    /// <summary>Who made it: `library` for a recording the station was given.</summary>
    public string Source { get; init; } = string.Empty;

    public string? Script { get; init; }

    /// <summary>Why it failed, which is the only thing that makes a failed row actionable.</summary>
    public string? Error { get; init; }

    public string Voice { get; init; } = "default";

    public string Length { get; init; } = "–";

    /// <summary>
    /// Only a recording the station was GIVEN can be taken back. Anything it wrote and spoke for
    /// itself is named by the running order and its script history, and is had again by rendering.
    /// </summary>
    public bool CanDelete { get; init; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PlayLabel))]
    private bool _isPlaying;

    public string PlayLabel => IsPlaying ? "Stop" : "Play";
}

/// <summary>
/// Everything the station can play that is not a record, and the three ways into it.
/// </summary>
/// <remarks>
/// <para>
/// Only `ready` can air: the station skips anything else rather than waiting, so the four stages of
/// being made are standby rather than faults, and `failed` is the one fault because it will not
/// resolve on its own.
/// </para>
/// <para>
/// Two things it deliberately does not do, as the console does not. It cannot put a segment in the
/// running order, which belongs to the page that owns the order. And it cannot re-render a failed one,
/// because no route does: a client-side retry would be a delete and a re-create wearing one button.
/// </para>
/// </remarks>
public sealed partial class SegmentsViewModel(
    OperatorActions actions,
    HttpClient http,
    PreviewsViewModel previews,
    IDialogs dialogs,
    IFilePicker files) : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<SegmentRowViewModel> Segments { get; } = [];

    /// <summary>The kinds the station holds, offered when a recording is filed.</summary>
    public IReadOnlyList<string> Kinds { get; private set; } = [];

    public string? Empty => Segments.Count > 0 ? null
        : "The station has no segments. Upload a recording, write one for the station to say, or drop audio into the inbox "
            + "folder and scan it. Without a segment it plays records back to back.";

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Render.ListSegmentsAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is not null)
        {
            Present(list.Segments);
        }
    }

    /// <summary>Draws the library grouped by kind, which is what an operator arrives looking for.</summary>
    public void Present(IEnumerable<Segment> segments)
    {
        ArgumentNullException.ThrowIfNull(segments);

        var rows = segments.OrderBy(segment => segment.Kind, StringComparer.Ordinal).ToList();
        Kinds = [.. rows.Select(segment => segment.Kind).Distinct(StringComparer.Ordinal)];

        Segments.Clear();
        string? last = null;
        foreach (var segment in rows)
        {
            Segments.Add(new SegmentRowViewModel(
                segment.Id,
                segment.Label,
                segment.Kind,
                segment.State.ToString().ToLowerInvariant(),
                segment.State switch
                {
                    SegmentState.Ready => StatusTone.Ok,
                    SegmentState.Failed => StatusTone.Fault,
                    _ => StatusTone.Standby,
                },
                // The audio endpoint takes a uuid where the list sends a string, so a row whose id
                // is not one has no audio this app can ask for.
                segment.Playable && Guid.TryParse(segment.Id, out _))
            {
                Heading = segment.Kind == last ? null : segment.Kind,
                Source = segment.Source,
                Script = segment.Script,
                Error = segment.Error,
                Voice = segment.Delivery is { } delivery ? $"{segment.Voice ?? "default"}, {delivery}" : segment.Voice ?? "default",
                Length = AudioFiles.Length(segment.DurationMs),
                CanDelete = segment.Source == "library" && Guid.TryParse(segment.Id, out _),
                IsPlaying = previews.Playing == SegmentKey(segment.Id),
            });
            last = segment.Kind;
        }

        OnPropertyChanged(nameof(Kinds));
        OnPropertyChanged(nameof(Empty));
    }

    /// <summary>Plays a recording through the app's one preview, or stops it.</summary>
    [RelayCommand]
    private async Task PlaySegmentAsync(SegmentRowViewModel segment)
    {
        ArgumentNullException.ThrowIfNull(segment);

        if (!Guid.TryParse(segment.Id, out var id))
        {
            return;
        }

        await previews.ToggleAsync(
            SegmentKey(segment.Id),
            async token => Clips.From(await RunAsync<object>(
                async (sdk, inner) => await sdk.Render.GetSegmentAudioAsync(id, inner).ConfigureAwait(false),
                cancellationToken: token).ConfigureAwait(true))).ConfigureAwait(true);

        foreach (var row in Segments)
        {
            row.IsPlaying = previews.Playing == SegmentKey(row.Id);
        }
    }

    /// <summary>
    /// Writes a segment for the station to say. It answers `planned` every time, because speaking it is
    /// a job, so the row is shown being made rather than waited for.
    /// </summary>
    [RelayCommand]
    private async Task ComposeAsync()
    {
        var voices = await RunAsync((sdk, token) => sdk.Render.ListVoicesAsync(token)).ConfigureAwait(true);
        var dialog = new SegmentComposeDialogViewModel(Actions, Http, Station, voices?.Voices ?? []);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true))
        {
            Notice = "Planned. The station is speaking it now.";
            await LoadAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }

    /// <summary>Takes a recording from this Mac into the library, filed under a kind.</summary>
    [RelayCommand]
    private async Task UploadAsync()
    {
        var picked = await files.OpenAsync("Upload a recording", AudioFiles.Patterns).ConfigureAwait(true);
        if (picked is null)
        {
            return;
        }

        var dialog = new SegmentUploadDialogViewModel(Actions, Http, Station, picked, Kinds);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true))
        {
            Notice = $"{dialog.Label} is in the library.";
            await LoadAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }

    /// <summary>Reads the inbox folder and takes in any audio it does not already hold. Safe to repeat.</summary>
    [RelayCommand]
    private async Task ScanAsync()
    {
        var scan = await RunAsync((sdk, token) => sdk.Render.ScanTheSegmentInboxAsync(token)).ConfigureAwait(true);
        if (scan is null)
        {
            return;
        }

        Notice = scan.Imported == 0
            ? $"Nothing new in the inbox ({scan.Scanned} scanned)."
            : $"Imported {scan.Imported} of {scan.Scanned} scanned.";
        await LoadAsync(CancellationToken.None).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task DeleteAsync(SegmentRowViewModel segment)
    {
        ArgumentNullException.ThrowIfNull(segment);

        if (!Guid.TryParse(segment.Id, out var id)
            || !await dialogs.ConfirmAsync(
                $"Delete {segment.Label}?",
                "The inbox file goes too, so the next scan does not read it back in. Anything the station has already aired stays in the activity feed.",
                "Delete the recording").ConfigureAwait(true))
        {
            return;
        }

        var list = await RunAsync((sdk, token) => sdk.Render.DeleteSegmentAsync(id, token)).ConfigureAwait(true);
        if (list is not null)
        {
            Notice = $"Deleted {segment.Label}.";
            Present(list.Segments);
        }
    }

    /// <summary>Raised to read every attempt at writing one break.</summary>
    public event Action<string>? SaidRequested;

    /// <summary>Every attempt at writing this one break, including the ones that came to nothing.</summary>
    [RelayCommand]
    private void ShowSaid(SegmentRowViewModel segment)
    {
        ArgumentNullException.ThrowIfNull(segment);
        SaidRequested?.Invoke(segment.Id);
    }

    private static string SegmentKey(string id) => $"segment:{id}";
}
