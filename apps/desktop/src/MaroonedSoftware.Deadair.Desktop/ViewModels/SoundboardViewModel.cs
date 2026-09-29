using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>Whether one sound is on one set.</summary>
public sealed partial class PadSetChoiceViewModel(Guid setId, Guid padId, string key, bool on) : ObservableObject
{
    public Guid SetId { get; } = setId;

    public Guid PadId { get; } = padId;

    public string Key { get; } = key;

    [ObservableProperty]
    private bool _isOn = on;
}

/// <summary>One sound on the rack.</summary>
public sealed partial class PadRowViewModel(Pad pad, IReadOnlyList<PadSetChoiceViewModel> sets) : ObservableObject
{
    public Pad Pad { get; } = pad;

    public string Token => PadText.Token(Pad.Name);

    public string Label => Pad.Label;

    public string? SourcePath => Pad.SourcePath;

    public string Length => PadText.Seconds(Pad.DurationMs);

    public string Loudness => PadText.Loudness(Pad.LoudnessLufs);

    public string LastHit => PadText.LastHit(Pad.LastUsedAt);

    /// <summary>A checkbox per set, which is membership; a turned-down sound keeps its sets but offers none.</summary>
    public IReadOnlyList<PadSetChoiceViewModel> Sets { get; } = sets;

    public bool IsActive => Pad.State == PadState2.Active;

    public bool IsRejected => Pad.State == PadState2.Rejected;

    /// <summary>
    /// Only a file this station wrote from an upload or a fetch. One somebody dropped into the library
    /// on disk is theirs, and deleting its row would only bring it back on the next scan.
    /// </summary>
    public bool CanDelete => Pad.Source != "library";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PlayLabel))]
    private bool _isPlaying;

    public string PlayLabel => IsPlaying ? "Stop" : "Hear";
}

/// <summary>One set a persona can point at.</summary>
public sealed record PadSetRowViewModel(PadSet Set)
{
    public string Key => Set.Key;

    public string Sounds => Set.Pads == 1 ? "1 sound" : $"{Set.Pads} sounds";

    public string Reaches => PadText.Reaches(Set);
}

/// <summary>
/// The sounds a presenter reaches for, and the sets that decide who reaches which.
/// </summary>
/// <remarks>
/// <para>
/// A sound comes in by one of three doors: an upload from this Mac, a fetch from an address, or a file
/// dropped into the pad library on disk and a re-scan. Whichever door, its board is a folder and also
/// a set, and a persona points at a set by name.
/// </para>
/// <para>
/// Taking a sound out of use is a state rather than a delete, because the scan re-reads the library
/// and a removed row would be back on the next pass. A turned-down sound keeps its sets and reserves
/// nothing, and putting it back makes it reachable again.
/// </para>
/// </remarks>
public sealed partial class SoundboardViewModel(
    OperatorActions actions,
    HttpClient http,
    PreviewsViewModel previews,
    IDialogs dialogs,
    IFilePicker files) : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<PadRowViewModel> Active { get; } = [];

    public ObservableCollection<PadRowViewModel> TurnedDown { get; } = [];

    public ObservableCollection<PadSetRowViewModel> Sets { get; } = [];

    public bool HasTurnedDown => TurnedDown.Count > 0;

    public bool IsEmpty => Active.Count == 0;

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Render.ListPadsAsync(token), cancellationToken: cancellationToken).ConfigureAwait(true);
        if (list is not null)
        {
            Present(list);
        }
    }

    /// <summary>Draws the rack. Every write answers the whole of it, because more than one row can move.</summary>
    public void Present(PadList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        var sets = list.Sets.OrderBy(set => set.Position).ToList();

        Sets.Clear();
        foreach (var set in sets)
        {
            Sets.Add(new PadSetRowViewModel(set));
        }

        Active.Clear();
        TurnedDown.Clear();
        foreach (var pad in list.Pads)
        {
            var row = new PadRowViewModel(
                pad,
                pad.State == PadState2.Active ? [.. sets.Select(set => new PadSetChoiceViewModel(set.Id, pad.Id, set.Key, pad.Sets.Contains(set.Key)))] : [])
            {
                IsPlaying = previews.Playing == PadKey(pad.Id),
            };
            (row.IsActive ? Active : TurnedDown).Add(row);
        }

        OnPropertyChanged(nameof(HasTurnedDown));
        OnPropertyChanged(nameof(IsEmpty));
    }

    [RelayCommand]
    private async Task UploadAsync()
    {
        var picked = await files.OpenAsync("Upload a sound", AudioFiles.Patterns).ConfigureAwait(true);
        if (picked is null)
        {
            return;
        }

        var dialog = new PadUploadDialogViewModel(Actions, Http, Station, picked, [.. Sets.Select(set => set.Key)]);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } list)
        {
            Notice = $"{dialog.Token} is on the {dialog.Board.Trim()} board.";
            Present(list);
        }
    }

    [RelayCommand]
    private async Task FetchAsync()
    {
        var dialog = new PadFetchDialogViewModel(Actions, Http, Station, [.. Sets.Select(set => set.Key)]);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } list)
        {
            Notice = $"Fetched onto the {dialog.Board} board.";
            Present(list);
        }
    }

    /// <summary>Reads the pad library on disk. Safe to repeat: a sound is identified by its file.</summary>
    [RelayCommand]
    private async Task ScanAsync()
    {
        var result = await RunAsync((sdk, token) => sdk.Render.ScanThePadLibraryAsync(token)).ConfigureAwait(true);
        if (result is not null)
        {
            Notice = PadText.ScanSummary(result);
            await LoadAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private async Task PlayAsync(PadRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        await previews.ToggleAsync(
            PadKey(row.Pad.Id),
            async token => Clips.From(await RunAsync<object>(
                async (sdk, inner) => await sdk.Render.GetPadAudioAsync(row.Pad.Id, inner).ConfigureAwait(false),
                cancellationToken: token).ConfigureAwait(true))).ConfigureAwait(true);

        foreach (var each in Active.Concat(TurnedDown))
        {
            each.IsPlaying = previews.Playing == PadKey(each.Pad.Id);
        }
    }

    /// <summary>Saves the sound's own file somewhere on this Mac.</summary>
    [RelayCommand]
    private async Task SaveFileAsync(PadRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var clip = Clips.From(await RunAsync<object>(
            async (sdk, token) => await sdk.Render.GetPadAudioAsync(row.Pad.Id, token).ConfigureAwait(false)).ConfigureAwait(true));

        if (clip is not null && await files.SaveAsync($"Save {row.Label}", row.Pad.Name + clip.Extension, clip.Data).ConfigureAwait(true))
        {
            Notice = $"Saved {row.Label}.";
        }
    }

    /// <summary>Puts a sound on a set or takes it off, as the checkbox now says.</summary>
    [RelayCommand]
    private async Task ToggleSetAsync(PadSetChoiceViewModel choice)
    {
        ArgumentNullException.ThrowIfNull(choice);

        var on = choice.IsOn;
        if (!await WriteAsync((sdk, token) => sdk.Render.SetPadMembershipAsync(choice.SetId, new PadSetMembership { PadId = choice.PadId, On = on }, token))
                .ConfigureAwait(true))
        {
            // Refused, so the box goes back to what the station holds.
            choice.IsOn = !on;
        }
    }

    /// <summary>Takes a sound out of use. Kept, so the next scan does not put it back.</summary>
    [RelayCommand]
    private Task TurnDownAsync(PadRowViewModel row) => SetStateAsync(row, PadStateState.Rejected);

    [RelayCommand]
    private Task PutBackAsync(PadRowViewModel row) => SetStateAsync(row, PadStateState.Active);

    [RelayCommand]
    private async Task DeleteAsync(PadRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (!await dialogs.ConfirmAsync(
                $"Delete {row.Label}?",
                $"The file this station wrote for it goes too, so the next scan does not read it back in. A script already written naming {row.Token} will find nothing and be spoken without it.",
                "Delete the sound").ConfigureAwait(true))
        {
            return;
        }

        await WriteAsync((sdk, token) => sdk.Render.DeletePadAsync(row.Pad.Id, token)).ConfigureAwait(true);
    }

    [RelayCommand]
    private async Task AddSetAsync()
    {
        var dialog = new PadSetDialogViewModel(Actions, Http, Station, null);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } list)
        {
            Present(list);
        }
    }

    /// <summary>Renames a set. A persona names a set by its name, so renaming one unpoints whoever pointed at it, and the dialog says who.</summary>
    [RelayCommand]
    private async Task RenameSetAsync(PadSetRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var dialog = new PadSetDialogViewModel(Actions, Http, Station, row.Set);
        if (await dialogs.ShowAsync(dialog).ConfigureAwait(true) && dialog.Result is { } list)
        {
            Present(list);
        }
    }

    [RelayCommand]
    private async Task DeleteSetAsync(PadSetRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var who = row.Set.Personas.Count == 0
            ? "Nobody is pointed at it."
            : $"{string.Join(", ", row.Set.Personas)} will be left with nothing to reach for.";
        if (!await dialogs.ConfirmAsync(
                $"Delete the {row.Key} set?",
                $"Every sound on it stays in the library and on any other set. {who}",
                "Delete the set").ConfigureAwait(true))
        {
            return;
        }

        await WriteAsync((sdk, token) => sdk.Render.DeletePadSetAsync(row.Set.Id, token)).ConfigureAwait(true);
    }

    private async Task SetStateAsync(PadRowViewModel row, PadStateState state)
    {
        ArgumentNullException.ThrowIfNull(row);
        await WriteAsync((sdk, token) => sdk.Render.SetPadStateAsync(row.Pad.Id, new PadState { State = state }, token)).ConfigureAwait(true);
    }

    private async Task<bool> WriteAsync(Func<DeadairSdk, CancellationToken, Task<PadList>> write)
    {
        var list = await RunAsync(write).ConfigureAwait(true);
        if (list is null)
        {
            return false;
        }

        Present(list);
        return true;
    }

    private static string PadKey(Guid id) => $"pad:{id}";
}
