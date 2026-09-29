using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
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

    /// <summary>Only a segment that is ready has audio to play.</summary>
    public bool CanPlay { get; } = canPlay;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PlayLabel))]
    private bool _isPlaying;

    public string PlayLabel => IsPlaying ? "Stop" : "Play";
}

/// <summary>The audio the station holds: breaks, idents, anything recorded or rendered.</summary>
public sealed partial class SegmentsViewModel(OperatorActions actions, HttpClient http, PreviewsViewModel previews)
    : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<SegmentRowViewModel> Segments { get; } = [];

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var list = await RunAsync((sdk, token) => sdk.Render.ListSegmentsAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is null)
        {
            return;
        }

        Segments.Clear();
        foreach (var segment in list.Segments)
        {
            // `ready` alone can air. Everything before it is a stage of being made, and drawing those
            // as faults would make an ordinary pipeline look broken.
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
                segment.State == SegmentState.Ready && Guid.TryParse(segment.Id, out _))
            {
                IsPlaying = previews.Playing == SegmentKey(segment.Id),
            });
        }
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

    private static string SegmentKey(string id) => $"segment:{id}";
}
